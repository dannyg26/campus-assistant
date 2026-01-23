# app/routers/uploads.py
from __future__ import annotations

import base64
import os
import re
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/uploads", tags=["uploads"])

# Accept common image types
ALLOWED_MIMES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
}

DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<b64>.+)$", re.DOTALL)


class UploadBase64Request(BaseModel):
    data_url: str = Field(..., min_length=20, description="data:<mime>;base64,<...>")


class UploadBase64Response(BaseModel):
    url: str


def _project_root() -> Path:
    # app/routers/uploads.py -> app/routers -> app -> project_root
    return Path(__file__).resolve().parents[2]


def _uploads_dir() -> Path:
    # Serve as /static/uploads/<file>
    root = _project_root()
    static_dir = root / "static"
    uploads_dir = static_dir / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    return uploads_dir


@router.post("/base64", response_model=UploadBase64Response, status_code=status.HTTP_201_CREATED)
def upload_base64(req: UploadBase64Request) -> UploadBase64Response:
    m = DATA_URL_RE.match(req.data_url.strip())
    if not m:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid data_url format. Expected data:<mime>;base64,<payload>.",
        )

    mime = m.group("mime").strip().lower()
    b64 = m.group("b64").strip()

    if mime not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image mime type: {mime}",
        )

    # Decode base64
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 payload.",
        )

    # Basic size guard (8MB)
    if len(raw) > 8_000_000:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large (max 8MB).",
        )

    ext = ALLOWED_MIMES[mime]
    # Safe-ish unique filename
    filename = f"upload_{os.urandom(12).hex()}.{ext}"

    out_dir = _uploads_dir()
    out_path = out_dir / filename

    try:
        out_path.write_bytes(raw)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file: {e}",
        )

    # Client will convert relative -> absolute using API_BASE_URL
    return UploadBase64Response(url=f"/static/uploads/{filename}")
