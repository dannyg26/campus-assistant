# app/deps.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, cast

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.db import get_conn, users
from app.security import AuthError, decode_access_token, normalize_bearer_token

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    user_id: str
    org_id: str
    role: Literal["admin", "student"]
    email: str
    name: str
    profile_pic: Optional[str] = None


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> CurrentUser:
    if creds is None:
        raise _unauthorized("Missing Authorization header")

    # Protect against pasting "Bearer <token>" into Swagger
    token = normalize_bearer_token(creds.credentials)

    try:
        payload = decode_access_token(token)
    except AuthError as e:
        raise _unauthorized(str(e))

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    role = payload.get("role")

    if not user_id or not org_id or role not in ("admin", "student"):
        raise _unauthorized("Token missing required claims")

    user_id_s = str(user_id)
    org_id_s = str(org_id)
    role_s = cast(Literal["admin", "student"], role)

    with get_conn() as conn:
        row = conn.execute(
            select(
                users.c.id,
                users.c.org_id,
                users.c.role,
                users.c.email,
                users.c.name,
                users.c.profile_pic,
                users.c.is_active,
                users.c.deleted_at,
            ).where(users.c.id == user_id_s)
        ).mappings().first()

        if not row:
            raise _unauthorized("User not found")

        if str(row["org_id"]) != org_id_s:
            raise _unauthorized("Token org mismatch")

        if row["deleted_at"] is not None:
            raise _unauthorized("Account removed")

        if not row["is_active"]:
            raise _unauthorized("Account disabled")

        if str(row["role"]) != role_s:
            raise _unauthorized("Token role mismatch")

        return CurrentUser(
            user_id=str(row["id"]),
            org_id=str(row["org_id"]),
            role=cast(Literal["admin", "student"], row["role"]),
            email=str(row["email"]),
            name=str(row["name"]),
            profile_pic=str(row["profile_pic"]) if row["profile_pic"] else None,
        )


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
