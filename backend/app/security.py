# app/security.py
from __future__ import annotations

import base64
import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import bcrypt
import jwt
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ISSUER = os.getenv("JWT_ISSUER", "campus-nav")
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))
REFRESH_TOKEN_PEPPER = os.getenv("REFRESH_TOKEN_PEPPER", "")

if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set. Add it to .env")
if not REFRESH_TOKEN_PEPPER:
    raise RuntimeError("REFRESH_TOKEN_PEPPER is not set. Add it to .env")

BCRYPT_ROUNDS = 12


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthError(Exception):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def _decode(token: str) -> dict[str, Any]:
    # Require issuer + exp + sub
    return jwt.decode(
        token,
        JWT_SECRET,
        algorithms=["HS256"],
        issuer=JWT_ISSUER,
        options={"require": ["exp", "iss", "sub"]},
    )


def normalize_bearer_token(token: str) -> str:
    """
    Accept either:
      - "<jwt>"
      - "Bearer <jwt>"
    This protects you from Swagger/user pasting "Bearer " manually.
    """
    t = (token or "").strip()
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    return t


def hash_password(password: str) -> str:
    # Pre-hash to avoid bcrypt 72-byte truncation issues
    password_bytes = password.encode("utf-8")
    password_hash_bytes = hashlib.sha256(password_bytes).digest()  # 32 bytes
    password_hash_str = base64.b64encode(password_hash_bytes).decode("ascii")  # 44 chars

    hashed = bcrypt.hashpw(
        password_hash_str.encode("utf-8"),
        bcrypt.gensalt(rounds=BCRYPT_ROUNDS),
    )
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    password_bytes = password.encode("utf-8")
    password_hash_bytes = hashlib.sha256(password_bytes).digest()
    password_hash_str = base64.b64encode(password_hash_bytes).decode("ascii")
    try:
        return bcrypt.checkpw(password_hash_str.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def make_access_token(*, user_id: str, org_id: str, role: Literal["admin", "student"]) -> str:
    exp = utcnow() + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    payload = {
        "iss": JWT_ISSUER,
        "sub": user_id,
        "org_id": org_id,
        "role": role,
        "exp": int(exp.timestamp()),
        "type": "access",
    }
    return _encode(payload)


def make_refresh_token(*, user_id: str, org_id: str) -> tuple[str, datetime]:
    """
    Refresh token is NOT a JWT. It's a random secret stored hashed in DB.
    """
    token = secrets.token_urlsafe(48)  # long, unguessable
    expires_at = utcnow() + timedelta(days=REFRESH_TOKEN_DAYS)
    return token, expires_at


def hash_refresh_token(token: str) -> str:
    t = (token or "").strip()
    material = f"{t}:{REFRESH_TOKEN_PEPPER}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def decode_access_token(token: str) -> dict[str, Any]:
    t = normalize_bearer_token(token)
    try:
        payload = _decode(t)
        if payload.get("type") != "access":
            raise AuthError("Not an access token")
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthError("Token expired")
    except jwt.InvalidIssuerError:
        raise AuthError(f"Invalid token issuer (expected '{JWT_ISSUER}')")
    except jwt.MissingRequiredClaimError as e:
        raise AuthError(f"Token missing required claim: {e.claim_name}")
    except jwt.InvalidTokenError as e:
        msg = str(e) if str(e) else "Invalid token"
        raise AuthError(f"Invalid token: {msg}")
