# app/routers/orgs.py
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import insert, select, update

from app.db import (
    get_conn,
    get_org_by_id,
    list_public_orgs,
    new_id,
    organizations,
    org_domains,
    refresh_tokens,
    users,
    utcnow_iso,
)
from app.deps import CurrentUser, get_current_user, require_admin
from app.security import (
    Tokens,
    hash_password,
    hash_refresh_token,
    make_access_token,
    make_refresh_token,
)

router = APIRouter(prefix="/orgs", tags=["orgs"])


class OrgListItem(BaseModel):
    id: str
    name: str


class OrgRegisterRequest(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    allowed_email_domains: Optional[list[str]] = None
    org_profile_pic: Optional[str] = None
    admin_name: str = Field(min_length=1, max_length=200)
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=200)


class OrgRegisterResponse(BaseModel):
    org_id: str
    org_name: str
    allowed_email_domains: Optional[list[str]] = None
    org_profile_pic: Optional[str] = None
    tokens: Tokens


class OrgMeResponse(BaseModel):
    id: str
    name: str
    org_profile_pic: Optional[str] = None


class OrgMeUpdateRequest(BaseModel):
    name: Optional[str] = None
    org_profile_pic: Optional[str] = None


def _normalize_domains(domains: Optional[list[str]]) -> Optional[list[str]]:
    if not domains:
        return None
    out: list[str] = []
    for d in domains:
        dd = (d or "").strip().lower()
        if dd:
            out.append(dd)
    seen: set[str] = set()
    uniq: list[str] = []
    for d in out:
        if d not in seen:
            seen.add(d)
            uniq.append(d)
    return uniq or None


def _email_domain(email: str) -> str:
    parts = email.strip().lower().split("@")
    if len(parts) != 2:
        return ""
    return parts[1]


@router.get("", response_model=list[OrgListItem])
def get_orgs() -> list[OrgListItem]:
    with get_conn() as conn:
        return [OrgListItem(**o) for o in list_public_orgs(conn)]


@router.post("/register", response_model=OrgRegisterResponse)
def register_org(req: OrgRegisterRequest) -> OrgRegisterResponse:
    domains = _normalize_domains(req.allowed_email_domains)
    admin_email = req.admin_email.strip().lower()

    if domains:
        dom = _email_domain(admin_email)
        if not dom or dom not in domains:
            raise HTTPException(
                status_code=400,
                detail="Admin email domain is not allowed for this organization policy.",
            )

    org_id = new_id()
    admin_id = new_id()

    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(organizations).values(
                id=org_id,
                name=req.org_name.strip(),
                allowed_email_domains=json.dumps(domains) if domains else None,
                org_profile_pic=req.org_profile_pic if req.org_profile_pic else None,
                is_public=True,
                created_at=utcnow_iso(),
            )
        )

        if domains:
            for d in domains:
                try:
                    conn.execute(
                        insert(org_domains).values(
                            id=new_id(),
                            org_id=org_id,
                            domain=d,
                            created_at=utcnow_iso(),
                        )
                    )
                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Domain '{d}' is already registered to another university.",
                    )

        conn.execute(
            insert(users).values(
                id=admin_id,
                org_id=org_id,
                email=admin_email,
                name=req.admin_name.strip(),
                password_hash=hash_password(req.admin_password),
                role="admin",
                is_active=True,
                deleted_at=None,
                purge_after=None,
                created_at=utcnow_iso(),
            )
        )

        access = make_access_token(user_id=admin_id, org_id=org_id, role="admin")
        refresh_raw, refresh_exp = make_refresh_token(user_id=admin_id, org_id=org_id)
        refresh_h = hash_refresh_token(refresh_raw)

        conn.execute(
            insert(refresh_tokens).values(
                id=new_id(),
                org_id=org_id,
                user_id=admin_id,
                token_hash=refresh_h,
                expires_at=refresh_exp.isoformat(),
                revoked_at=None,
                created_at=utcnow_iso(),
            )
        )

    return OrgRegisterResponse(
        org_id=org_id,
        org_name=req.org_name.strip(),
        allowed_email_domains=domains,
        org_profile_pic=req.org_profile_pic,
        tokens=Tokens(access_token=access, refresh_token=refresh_raw),
    )


@router.get("/me", response_model=OrgMeResponse)
def get_my_org(user: CurrentUser = Depends(get_current_user)) -> OrgMeResponse:
    """Return the current user's organization (id, name, org_profile_pic)."""
    with get_conn() as conn:
        org = get_org_by_id(conn, user.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return OrgMeResponse(
        id=str(org["id"]),
        name=str(org["name"]),
        org_profile_pic=str(org["org_profile_pic"]) if org.get("org_profile_pic") else None,
    )


@router.patch("/me", response_model=OrgMeResponse)
def update_my_org(
    req: OrgMeUpdateRequest,
    admin: CurrentUser = Depends(require_admin),
) -> OrgMeResponse:
    """Update the current user's organization (admin-only). Supports name and org_profile_pic."""
    raw = req.model_dump(exclude_unset=True) if hasattr(req, "model_dump") else req.dict(exclude_unset=True)
    updates = {k: raw[k] for k in ("name", "org_profile_pic") if k in raw}
    if "name" in updates:
        n = (updates["name"] or "").strip()
        if not n:
            raise HTTPException(status_code=400, detail="Organization name cannot be empty")
        updates["name"] = n
    if not updates:
        # no-op: fetch and return current
        pass
    else:
        with get_conn() as conn, conn.begin():
            conn.execute(
                update(organizations).where(organizations.c.id == admin.org_id).values(**updates)
            )
    with get_conn() as conn:
        org = get_org_by_id(conn, admin.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return OrgMeResponse(
        id=str(org["id"]),
        name=str(org["name"]),
        org_profile_pic=str(org["org_profile_pic"]) if org.get("org_profile_pic") else None,
    )
