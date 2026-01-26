# app/routers/events.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update

from app.db import (
    events,
    event_images,
    get_conn,
    new_id,
    users,
    utcnow_iso,
)
from app.deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/events", tags=["events"])


# ----------------------------
# Schemas
# ----------------------------
class PictureIn(BaseModel):
    url: str = Field(min_length=1)
    caption: Optional[str] = None


class CreateEventRequest(BaseModel):
    event_name: str = Field(min_length=1, max_length=500)
    location: Optional[str] = None
    top_qualities: Optional[str] = None
    description: Optional[str] = None

    # NEW: multi-images
    pictures: list[PictureIn] = Field(default_factory=list)

    # Backward-compat (old clients)
    picture: Optional[str] = None

    meeting_time: Optional[str] = None


class PatchEventRequest(BaseModel):
    event_name: Optional[str] = Field(None, min_length=1, max_length=500)
    location: Optional[str] = None
    top_qualities: Optional[str] = None
    description: Optional[str] = None

    # NEW: if provided:
    # - [] clears images
    # - [..] replaces images
    # If omitted (None) = do not change images
    pictures: Optional[list[PictureIn]] = None

    # Backward-compat (old clients)
    picture: Optional[str] = None

    meeting_time: Optional[str] = None


class EventResponse(BaseModel):
    id: str
    event_name: str
    location: Optional[str] = None
    top_qualities: Optional[str] = None
    description: Optional[str] = None

    # NEW
    pictures: list[PictureIn] = Field(default_factory=list)

    # Backward-compat
    picture: Optional[str] = None

    meeting_time: Optional[str] = None
    created_by_user_id: str
    created_by_name: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


# ----------------------------
# Helpers
# ----------------------------
def _count_qualities(text: Optional[str]) -> int:
    if not text:
        return 0
    return len([q for q in [t.strip() for t in text.replace("\n", ",").split(",")] if q])


def _ensure_qualities_limit(text: Optional[str]) -> None:
    if text and _count_qualities(text) > 6:
        raise HTTPException(status_code=400, detail="Top qualities can have at most 6 items.")


def _get_event_pictures(conn, event_id: str) -> list[PictureIn]:
    rows = (
        conn.execute(
            select(event_images)
            .where(event_images.c.event_id == event_id)
            .order_by(event_images.c.position.asc().nulls_last(), event_images.c.created_at.asc())
        )
        .mappings()
        .all()
    )
    return [PictureIn(url=str(r["url"]), caption=str(r["caption"]) if r.get("caption") else None) for r in rows]


def _replace_event_pictures(conn, event_id: str, pictures: list[PictureIn]) -> None:
    # Remove old
    conn.execute(delete(event_images).where(event_images.c.event_id == event_id))

    # Insert new
    now = utcnow_iso()
    for i, p in enumerate(pictures):
        conn.execute(
            insert(event_images).values(
                id=new_id(),
                event_id=event_id,
                url=p.url.strip(),
                caption=p.caption.strip() if p.caption else None,
                position=i,
                created_at=now,
            )
        )


def _row_to_response(conn, r, creator_name: Optional[str]) -> EventResponse:
    pics = _get_event_pictures(conn, str(r["id"]))

    # backward compat: if old `picture` exists, keep it (also optionally mirror into pics)
    legacy_picture = str(r["picture"]) if r.get("picture") else None
    if legacy_picture and not pics:
        pics = [PictureIn(url=legacy_picture, caption=None)]

    return EventResponse(
        id=str(r["id"]),
        event_name=str(r["event_name"]),
        location=str(r["location"]) if r.get("location") else None,
        top_qualities=str(r["top_qualities"]) if r.get("top_qualities") else None,
        description=str(r["description"]) if r.get("description") else None,
        pictures=pics,
        picture=legacy_picture,
        meeting_time=str(r["meeting_time"]) if r.get("meeting_time") else None,
        created_by_user_id=str(r["created_by_user_id"]),
        created_by_name=creator_name,
        created_at=str(r["created_at"]),
        updated_at=str(r["updated_at"]) if r.get("updated_at") else None,
    )


# ----------------------------
# Routes
# ----------------------------
@router.get("", response_model=list[EventResponse])
def list_events(user: CurrentUser = Depends(get_current_user)) -> list[EventResponse]:
    with get_conn() as conn:
        q = select(events).where(events.c.org_id == user.org_id).order_by(events.c.created_at.desc())
        rows = conn.execute(q).mappings().all()

        out: list[EventResponse] = []
        for r in rows:
            creator = (
                conn.execute(select(users.c.name).where(users.c.id == r["created_by_user_id"]))
                .mappings()
                .first()
            )
            out.append(_row_to_response(conn, r, str(creator["name"]) if creator else None))
        return out


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    req: CreateEventRequest,
    admin: CurrentUser = Depends(require_admin),
) -> EventResponse:
    eid = new_id()
    now = utcnow_iso()
    _ensure_qualities_limit(req.top_qualities)

    # If client sent pictures, we store them in event_images.
    # If client only sent picture, we store it in legacy column (and also mirror to event_images for convenience).
    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(events).values(
                id=eid,
                org_id=admin.org_id,
                event_name=req.event_name.strip(),
                location=req.location.strip() if req.location else None,
                top_qualities=req.top_qualities.strip() if req.top_qualities else None,
                description=req.description.strip() if req.description else None,
                picture=req.picture if req.picture else None,  # legacy
                meeting_time=req.meeting_time.strip() if req.meeting_time else None,
                created_by_user_id=admin.user_id,
                created_at=now,
                updated_at=now,
            )
        )

        pics = req.pictures or []
        if pics:
            _replace_event_pictures(conn, eid, pics)
        elif req.picture:
            _replace_event_pictures(conn, eid, [PictureIn(url=req.picture, caption=None)])

        r = conn.execute(select(events).where(events.c.id == eid)).mappings().first()
        return _row_to_response(conn, r, admin.name)


@router.patch("/{event_id}", response_model=EventResponse)
def patch_event(
    event_id: str,
    req: PatchEventRequest,
    admin: CurrentUser = Depends(require_admin),
) -> EventResponse:
    with get_conn() as conn, conn.begin():
        _ensure_qualities_limit(req.top_qualities)

        row = (
            conn.execute(
                select(events).where(
                    events.c.id == event_id,
                    events.c.org_id == admin.org_id,
                )
            )
            .mappings()
            .first()
        )
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

        vals = {"updated_at": utcnow_iso()}
        if req.event_name is not None:
            vals["event_name"] = req.event_name.strip()
        if req.location is not None:
            vals["location"] = req.location.strip() if req.location else None
        if req.top_qualities is not None:
            vals["top_qualities"] = req.top_qualities.strip() if req.top_qualities else None
        if req.description is not None:
            vals["description"] = req.description.strip() if req.description else None
        if req.picture is not None:
            # legacy single picture column
            vals["picture"] = req.picture if req.picture else None
        if req.meeting_time is not None:
            vals["meeting_time"] = req.meeting_time.strip() if req.meeting_time else None

        conn.execute(
            update(events)
            .where(events.c.id == event_id, events.c.org_id == admin.org_id)
            .values(**vals)
        )

        # NEW behavior:
        # If pictures is provided, it replaces event_images (including clearing).
        if req.pictures is not None:
            _replace_event_pictures(conn, event_id, req.pictures)

            # Optional: keep legacy column aligned (first picture)
            first = req.pictures[0].url if req.pictures else None
            conn.execute(
                update(events)
                .where(events.c.id == event_id, events.c.org_id == admin.org_id)
                .values(picture=first)
            )

        r = conn.execute(select(events).where(events.c.id == event_id)).mappings().first()
        creator = (
            conn.execute(select(users.c.name).where(users.c.id == r["created_by_user_id"]))
            .mappings()
            .first()
        )
        return _row_to_response(conn, r, str(creator["name"]) if creator else None)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> None:
    with get_conn() as conn, conn.begin():
        # Explicit delete (even though DB cascade may exist) is fine and safe
        conn.execute(delete(event_images).where(event_images.c.event_id == event_id))

        r = conn.execute(
            delete(events).where(
                events.c.id == event_id,
                events.c.org_id == admin.org_id,
            )
        )
        if r.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
