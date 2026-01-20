# app/routers/auth.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import insert, select, update

from app.db import (
    get_conn,
    get_org_by_id,
    new_id,
    parse_domains_json,
    refresh_tokens,
    resolve_org_id_by_domain,
    users,
    utcnow_iso,
)
from app.security import (
    Tokens,
    hash_password,
    hash_refresh_token,
    make_access_token,
    make_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=2000)


class TokenResponse(BaseModel):
    tokens: Tokens


def _email_domain(email: str) -> str:
    parts = email.strip().lower().split("@")
    if len(parts) != 2:
        return ""
    return parts[1]


def _enforce_domain(org_row: dict, email: str) -> None:
    allowed = parse_domains_json(org_row.get("allowed_email_domains"))
    if not allowed:
        return
    dom = _email_domain(email)
    if dom not in allowed:
        raise HTTPException(status_code=400, detail="Email domain not allowed for this university.")


def _parse_iso_dt(value: str) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _normalize_refresh_token(token: str) -> str:
    return (token or "").strip()


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest) -> TokenResponse:
    email = req.email.strip().lower()
    name = req.name.strip()
    dom = _email_domain(email)

    if not dom:
        raise HTTPException(status_code=400, detail="Invalid email")

    with get_conn() as conn, conn.begin():
        org_id = resolve_org_id_by_domain(conn, dom)
        if not org_id:
            raise HTTPException(status_code=404, detail="No university found for this email domain.")

        org = get_org_by_id(conn, org_id)
        if not org:
            raise HTTPException(status_code=404, detail="University not found.")

        _enforce_domain(org, email)

        existing = conn.execute(
            select(users.c.id).where(
                users.c.org_id == org_id,
                users.c.email == email,
                users.c.deleted_at.is_(None),
            )
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Account already exists for this university.")

        user_id = new_id()
        conn.execute(
            insert(users).values(
                id=user_id,
                org_id=org_id,
                email=email,
                name=name,
                password_hash=hash_password(req.password),
                role="student",
                is_active=True,
                deleted_at=None,
                purge_after=None,
                created_at=utcnow_iso(),
            )
        )

        access = make_access_token(user_id=user_id, org_id=org_id, role="student")
        refresh_raw, refresh_exp = make_refresh_token(user_id=user_id, org_id=org_id)
        refresh_h = hash_refresh_token(refresh_raw)

        conn.execute(
            insert(refresh_tokens).values(
                id=new_id(),
                org_id=org_id,
                user_id=user_id,
                token_hash=refresh_h,
                expires_at=refresh_exp.isoformat(),
                revoked_at=None,
                created_at=utcnow_iso(),
            )
        )

    return TokenResponse(tokens=Tokens(access_token=access, refresh_token=refresh_raw))


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest) -> TokenResponse:
    email = req.email.strip().lower()
    dom = _email_domain(email)

    if not dom:
        raise HTTPException(status_code=400, detail="Invalid email")

    with get_conn() as conn, conn.begin():
        org_id = resolve_org_id_by_domain(conn, dom)
        if not org_id:
            raise HTTPException(status_code=404, detail="No university found for this email domain.")

        row = conn.execute(
            select(
                users.c.id,
                users.c.org_id,
                users.c.email,
                users.c.name,
                users.c.password_hash,
                users.c.role,
                users.c.is_active,
                users.c.deleted_at,
            ).where(
                users.c.org_id == org_id,
                users.c.email == email,
            )
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=400, detail="Invalid credentials")

        if row["deleted_at"] is not None:
            raise HTTPException(status_code=403, detail="Account removed")

        if not row["is_active"]:
            raise HTTPException(status_code=403, detail="Account is disabled")

        if not verify_password(req.password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Invalid credentials")

        access = make_access_token(user_id=row["id"], org_id=org_id, role=row["role"])
        refresh_raw, refresh_exp = make_refresh_token(user_id=row["id"], org_id=org_id)
        refresh_h = hash_refresh_token(refresh_raw)

        conn.execute(
            insert(refresh_tokens).values(
                id=new_id(),
                org_id=org_id,
                user_id=row["id"],
                token_hash=refresh_h,
                expires_at=refresh_exp.isoformat(),
                revoked_at=None,
                created_at=utcnow_iso(),
            )
        )

    return TokenResponse(tokens=Tokens(access_token=access, refresh_token=refresh_raw))


@router.post("/refresh", response_model=TokenResponse)
def refresh(req: RefreshRequest) -> TokenResponse:
    raw_refresh = _normalize_refresh_token(req.refresh_token)
    token_hash = hash_refresh_token(raw_refresh)
    now = datetime.now(timezone.utc)

    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(
                refresh_tokens.c.id,
                refresh_tokens.c.user_id,
                refresh_tokens.c.org_id,
                refresh_tokens.c.expires_at,
                refresh_tokens.c.revoked_at,
            ).where(refresh_tokens.c.token_hash == token_hash)
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=401, detail="Invalid refresh token")

        if row["revoked_at"] is not None:
            raise HTTPException(status_code=401, detail="Refresh token revoked")

        exp = _parse_iso_dt(row["expires_at"])
        if not exp:
            raise HTTPException(status_code=401, detail="Refresh token invalid")

        if exp <= now:
            raise HTTPException(status_code=401, detail="Refresh token expired")

        u = conn.execute(
            select(users.c.role, users.c.is_active, users.c.deleted_at).where(users.c.id == row["user_id"])
        ).mappings().first()

        if not u:
            raise HTTPException(status_code=403, detail="Account not found")

        if u["deleted_at"] is not None:
            raise HTTPException(status_code=403, detail="Account removed")

        if not u["is_active"]:
            raise HTTPException(status_code=403, detail="Account disabled")

        # Rotation: revoke old
        conn.execute(
            update(refresh_tokens)
            .where(refresh_tokens.c.id == row["id"])
            .values(revoked_at=utcnow_iso())
        )

        org_id = row["org_id"]

        access = make_access_token(user_id=row["user_id"], org_id=org_id, role=u["role"])
        refresh_raw, refresh_exp = make_refresh_token(user_id=row["user_id"], org_id=org_id)
        refresh_h = hash_refresh_token(refresh_raw)

        conn.execute(
            insert(refresh_tokens).values(
                id=new_id(),
                org_id=org_id,
                user_id=row["user_id"],
                token_hash=refresh_h,
                expires_at=refresh_exp.isoformat(),
                revoked_at=None,
                created_at=utcnow_iso(),
            )
        )

    return TokenResponse(tokens=Tokens(access_token=access, refresh_token=refresh_raw))
