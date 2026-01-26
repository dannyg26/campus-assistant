# app/routers/announcements.py
from __future__ import annotations

import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import insert, select, update, delete

from app.db import (
    get_conn,
    announcements,
    announcement_comments,
    users,
    new_id,
    utcnow_iso,
)
from app.deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/announcements", tags=["announcements"])


# ----------------------------
# JSON helpers (pictures column)
# ----------------------------
def _dump_pictures(pictures: list["PictureIn"]) -> str:
    return json.dumps([p.model_dump() for p in pictures])

def _load_pictures(raw: Optional[str]) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class PictureIn(BaseModel):
    url: str = Field(min_length=1)
    caption: Optional[str] = None


class CreateAnnouncementRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1)

    # New
    pictures: list[PictureIn] = Field(default_factory=list)

    # Backward compat (old clients)
    image: Optional[str] = None


class PatchAnnouncementRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    body: Optional[str] = Field(None, min_length=1)
    status: Optional[Literal["draft", "published"]] = None

    # New: allow patching pictures
    pictures: Optional[list[PictureIn]] = None

    # Backward compat (patching legacy single image)
    image: Optional[str] = None


class AnnouncementResponse(BaseModel):
    id: str
    org_id: str
    title: str
    body: str

    # New
    pictures: list[PictureIn] = Field(default_factory=list)

    # Backward compat
    image: Optional[str] = None

    status: Literal["draft", "published"]
    created_by_user_id: str
    created_by_name: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    published_at: Optional[str] = None


class CreateCommentRequest(BaseModel):
    body: str = Field(min_length=1)


class CommentResponse(BaseModel):
    id: str
    announcement_id: str
    org_id: str
    user_id: str
    user_name: Optional[str] = None
    body: str
    created_at: str


# ---------------------------------------------------------------------------
# GET /announcements — admin: all (draft+published); student: published only
# ---------------------------------------------------------------------------
@router.get("", response_model=list[AnnouncementResponse])
def list_announcements(user: CurrentUser = Depends(get_current_user)) -> list[AnnouncementResponse]:
    with get_conn() as conn:
        q = select(announcements).where(announcements.c.org_id == user.org_id)
        if user.role != "admin":
            q = q.where(announcements.c.status == "published")
        q = q.order_by(announcements.c.created_at.desc())
        rows = conn.execute(q).mappings().all()

        out: list[AnnouncementResponse] = []
        for r in rows:
            creator = conn.execute(
                select(users.c.name).where(users.c.id == r["created_by_user_id"])
            ).mappings().first()

            pics_raw = _load_pictures(r.get("pictures"))
            pics = [
                PictureIn(url=str(p["url"]), caption=str(p["caption"]) if p.get("caption") else None)
                for p in pics_raw
                if isinstance(p, dict) and p.get("url")
            ]

            image_fallback = (pics[0].url if pics else None) or (str(r["image"]) if r.get("image") else None)

            out.append(
                AnnouncementResponse(
                    id=str(r["id"]),
                    org_id=str(r["org_id"]),
                    title=str(r["title"]),
                    body=str(r["body"]),
                    pictures=pics,
                    image=image_fallback,
                    status=str(r["status"]),
                    created_by_user_id=str(r["created_by_user_id"]),
                    created_by_name=str(creator["name"]) if creator else None,
                    created_at=str(r["created_at"]),
                    updated_at=str(r["updated_at"]) if r.get("updated_at") else None,
                    published_at=str(r["published_at"]) if r.get("published_at") else None,
                )
            )
        return out


# ---------------------------------------------------------------------------
# POST /announcements — admin-only, create draft
# ---------------------------------------------------------------------------
@router.post("", response_model=AnnouncementResponse, status_code=status.HTTP_201_CREATED)
def create_announcement(
    req: CreateAnnouncementRequest,
    admin: CurrentUser = Depends(require_admin),
) -> AnnouncementResponse:
    aid = new_id()
    now = utcnow_iso()

    # Normalize legacy image -> pictures[0]
    pictures_in = list(req.pictures)
    if not pictures_in and req.image:
        pictures_in = [PictureIn(url=req.image)]

    pictures_json = _dump_pictures(pictures_in)
    image_fallback = pictures_in[0].url if pictures_in else None

    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(announcements).values(
                id=aid,
                org_id=admin.org_id,
                title=req.title.strip(),
                body=req.body.strip(),
                pictures=pictures_json,         # NEW column
                image=image_fallback,           # legacy column
                status="draft",
                created_by_user_id=admin.user_id,
                created_at=now,
                updated_at=now,
                published_at=None,
            )
        )

    return AnnouncementResponse(
        id=aid,
        org_id=admin.org_id,
        title=req.title.strip(),
        body=req.body.strip(),
        pictures=pictures_in,
        image=image_fallback,
        status="draft",
        created_by_user_id=admin.user_id,
        created_by_name=admin.name,
        created_at=now,
        updated_at=now,
        published_at=None,
    )


# ---------------------------------------------------------------------------
# PATCH /announcements/{id} — admin-only, edit title/body/status/pictures
# ---------------------------------------------------------------------------
@router.patch("/{announcement_id}", response_model=AnnouncementResponse)
def patch_announcement(
    announcement_id: str,
    req: PatchAnnouncementRequest,
    admin: CurrentUser = Depends(require_admin),
) -> AnnouncementResponse:
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == admin.org_id,
            )
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")

        vals = {"updated_at": utcnow_iso()}

        if req.title is not None:
            vals["title"] = req.title.strip()
        if req.body is not None:
            vals["body"] = req.body.strip()

        if req.status is not None:
            vals["status"] = req.status
            if req.status == "published" and not row.get("published_at"):
                vals["published_at"] = utcnow_iso()
            elif req.status == "draft":
                vals["published_at"] = None

        # If pictures is provided, it becomes the source of truth
        if req.pictures is not None:
            pics_in = list(req.pictures)
            vals["pictures"] = _dump_pictures(pics_in)
            # Keep legacy image in sync (first picture)
            vals["image"] = pics_in[0].url if pics_in else None

        # Backward compat: if image is provided (and pictures not provided), update both
        elif req.image is not None:
            if req.image:
                vals["pictures"] = _dump_pictures([PictureIn(url=req.image)])
                vals["image"] = req.image
            else:
                vals["pictures"] = _dump_pictures([])
                vals["image"] = None

        conn.execute(
            update(announcements)
            .where(announcements.c.id == announcement_id)
            .values(**vals)
        )

        updated = conn.execute(
            select(announcements).where(announcements.c.id == announcement_id)
        ).mappings().first()

        creator = conn.execute(
            select(users.c.name).where(users.c.id == updated["created_by_user_id"])
        ).mappings().first()

        pics_raw = _load_pictures(updated.get("pictures"))
        pics = [
            PictureIn(url=str(p["url"]), caption=str(p["caption"]) if p.get("caption") else None)
            for p in pics_raw
            if isinstance(p, dict) and p.get("url")
        ]
        image_fallback = (pics[0].url if pics else None) or (str(updated["image"]) if updated.get("image") else None)

        return AnnouncementResponse(
            id=str(updated["id"]),
            org_id=str(updated["org_id"]),
            title=str(updated["title"]),
            body=str(updated["body"]),
            pictures=pics,
            image=image_fallback,
            status=str(updated["status"]),
            created_by_user_id=str(updated["created_by_user_id"]),
            created_by_name=str(creator["name"]) if creator else None,
            created_at=str(updated["created_at"]),
            updated_at=str(updated["updated_at"]) if updated.get("updated_at") else None,
            published_at=str(updated["published_at"]) if updated.get("published_at") else None,
        )


# ---------------------------------------------------------------------------
# POST /announcements/{id}/publish — admin-only
# ---------------------------------------------------------------------------
@router.post("/{announcement_id}/publish", response_model=AnnouncementResponse)
def publish_announcement(
    announcement_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> AnnouncementResponse:
    now = utcnow_iso()

    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")

        conn.execute(
            update(announcements)
            .where(announcements.c.id == announcement_id)
            .values(status="published", published_at=now, updated_at=now)
        )

        updated = conn.execute(
            select(announcements).where(announcements.c.id == announcement_id)
        ).mappings().first()

        creator = conn.execute(
            select(users.c.name).where(users.c.id == updated["created_by_user_id"])
        ).mappings().first()

        pics_raw = _load_pictures(updated.get("pictures"))
        pics = [
            PictureIn(url=str(p["url"]), caption=str(p["caption"]) if p.get("caption") else None)
            for p in pics_raw
            if isinstance(p, dict) and p.get("url")
        ]
        image_fallback = (pics[0].url if pics else None) or (str(updated["image"]) if updated.get("image") else None)

        return AnnouncementResponse(
            id=str(updated["id"]),
            org_id=str(updated["org_id"]),
            title=str(updated["title"]),
            body=str(updated["body"]),
            pictures=pics,
            image=image_fallback,
            status="published",
            created_by_user_id=str(updated["created_by_user_id"]),
            created_by_name=str(creator["name"]) if creator else None,
            created_at=str(updated["created_at"]),
            updated_at=str(updated["updated_at"]) if updated.get("updated_at") else None,
            published_at=str(updated["published_at"]) if updated.get("published_at") else None,
        )


# ---------------------------------------------------------------------------
# POST /announcements/{id}/unpublish — admin-only
# ---------------------------------------------------------------------------
@router.post("/{announcement_id}/unpublish", response_model=AnnouncementResponse)
def unpublish_announcement(
    announcement_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> AnnouncementResponse:
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")

        conn.execute(
            update(announcements)
            .where(announcements.c.id == announcement_id)
            .values(status="draft", published_at=None, updated_at=utcnow_iso())
        )

        updated = conn.execute(
            select(announcements).where(announcements.c.id == announcement_id)
        ).mappings().first()

        creator = conn.execute(
            select(users.c.name).where(users.c.id == updated["created_by_user_id"])
        ).mappings().first()

        pics_raw = _load_pictures(updated.get("pictures"))
        pics = [
            PictureIn(url=str(p["url"]), caption=str(p["caption"]) if p.get("caption") else None)
            for p in pics_raw
            if isinstance(p, dict) and p.get("url")
        ]
        image_fallback = (pics[0].url if pics else None) or (str(updated["image"]) if updated.get("image") else None)

        return AnnouncementResponse(
            id=str(updated["id"]),
            org_id=str(updated["org_id"]),
            title=str(updated["title"]),
            body=str(updated["body"]),
            pictures=pics,
            image=image_fallback,
            status="draft",
            created_by_user_id=str(updated["created_by_user_id"]),
            created_by_name=str(creator["name"]) if creator else None,
            created_at=str(updated["created_at"]),
            updated_at=str(updated["updated_at"]) if updated.get("updated_at") else None,
            published_at=None,
        )


# ---------------------------------------------------------------------------
# DELETE /announcements/{id} — admin-only
# ---------------------------------------------------------------------------
@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> None:
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")

        conn.execute(
            delete(announcement_comments).where(
                announcement_comments.c.announcement_id == announcement_id
            )
        )
        conn.execute(delete(announcements).where(announcements.c.id == announcement_id))


# ---------------------------------------------------------------------------
# GET /announcements/{id}/comments — org members
# ---------------------------------------------------------------------------
@router.get("/{announcement_id}/comments", response_model=list[CommentResponse])
def list_comments(
    announcement_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[CommentResponse]:
    with get_conn() as conn:
        ann = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not ann:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
        if user.role != "admin" and str(ann["status"]) != "published":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Can only view comments on published announcements",
            )

        rows = conn.execute(
            select(announcement_comments)
            .where(
                announcement_comments.c.announcement_id == announcement_id,
                announcement_comments.c.org_id == user.org_id,
            )
            .order_by(announcement_comments.c.created_at.asc())
        ).mappings().all()

        out: list[CommentResponse] = []
        for r in rows:
            u = conn.execute(select(users.c.name).where(users.c.id == r["user_id"])).mappings().first()
            out.append(
                CommentResponse(
                    id=str(r["id"]),
                    announcement_id=str(r["announcement_id"]),
                    org_id=str(r["org_id"]),
                    user_id=str(r["user_id"]),
                    user_name=str(u["name"]) if u else None,
                    body=str(r["body"]),
                    created_at=str(r["created_at"]),
                )
            )
        return out


# ---------------------------------------------------------------------------
# POST /announcements/{id}/comments — org members; students only on published
# ---------------------------------------------------------------------------
@router.post("/{announcement_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_comment(
    announcement_id: str,
    req: CreateCommentRequest,
    user: CurrentUser = Depends(get_current_user),
) -> CommentResponse:
    with get_conn() as conn, conn.begin():
        ann = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not ann:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
        if user.role != "admin" and str(ann["status"]) != "published":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Can only comment on published announcements",
            )

        cid = new_id()
        now = utcnow_iso()
        conn.execute(
            insert(announcement_comments).values(
                id=cid,
                announcement_id=announcement_id,
                org_id=user.org_id,
                user_id=user.user_id,
                body=req.body.strip(),
                created_at=now,
            )
        )

    return CommentResponse(
        id=cid,
        announcement_id=announcement_id,
        org_id=user.org_id,
        user_id=user.user_id,
        user_name=user.name,
        body=req.body.strip(),
        created_at=now,
    )


# ---------------------------------------------------------------------------
# DELETE /announcements/{id}/comments/{comment_id} — admin or comment owner
# ---------------------------------------------------------------------------
@router.delete("/{announcement_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    announcement_id: str,
    comment_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    with get_conn() as conn, conn.begin():
        ann = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not ann:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")

        row = conn.execute(
            select(announcement_comments).where(
                announcement_comments.c.id == comment_id,
                announcement_comments.c.announcement_id == announcement_id,
                announcement_comments.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

        if user.role != "admin" and str(row["user_id"]) != user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Can only delete your own comments")

        conn.execute(
            delete(announcement_comments).where(
                announcement_comments.c.id == comment_id,
                announcement_comments.c.announcement_id == announcement_id,
            )
        )


# ---------------------------------------------------------------------------
# GET /announcements/{id} — single announcement (org members; students only published)
# ---------------------------------------------------------------------------
@router.get("/{announcement_id}", response_model=AnnouncementResponse)
def get_announcement(
    announcement_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> AnnouncementResponse:
    with get_conn() as conn:
        row = conn.execute(
            select(announcements).where(
                announcements.c.id == announcement_id,
                announcements.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
        if user.role != "admin" and str(row["status"]) != "published":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")

        creator = conn.execute(
            select(users.c.name).where(users.c.id == row["created_by_user_id"])
        ).mappings().first()

        pics_raw = _load_pictures(row.get("pictures"))
        pics = [
            PictureIn(url=str(p["url"]), caption=str(p["caption"]) if p.get("caption") else None)
            for p in pics_raw
            if isinstance(p, dict) and p.get("url")
        ]
        image_fallback = (pics[0].url if pics else None) or (str(row["image"]) if row.get("image") else None)

        return AnnouncementResponse(
            id=str(row["id"]),
            org_id=str(row["org_id"]),
            title=str(row["title"]),
            body=str(row["body"]),
            pictures=pics,
            image=image_fallback,
            status=str(row["status"]),
            created_by_user_id=str(row["created_by_user_id"]),
            created_by_name=str(creator["name"]) if creator else None,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]) if row.get("updated_at") else None,
            published_at=str(row["published_at"]) if row.get("published_at") else None,
        )
