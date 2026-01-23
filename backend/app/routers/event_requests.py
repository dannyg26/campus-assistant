# app/routers/event_requests.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update

from app.db import event_requests, events, get_conn, new_id, users, utcnow_iso
from app.deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/event-requests", tags=["event-requests"])


class CreateEventRequestRequest(BaseModel):
    event_name: str = Field(min_length=1, max_length=500)
    location: Optional[str] = None
    top_qualities: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None
    meeting_time: Optional[str] = None


class UpdateEventRequestRequest(BaseModel):
    event_name: Optional[str] = Field(None, min_length=1, max_length=500)
    location: Optional[str] = None
    top_qualities: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None
    meeting_time: Optional[str] = None
    admin_notes: Optional[str] = None


class DenyEventRequestRequest(BaseModel):
    admin_notes: Optional[str] = None


class ApproveEventResponse(BaseModel):
    event_id: str
    message: str = "Event created and request removed."


class EventRequestResponse(BaseModel):
    id: str
    event_name: str
    location: Optional[str] = None
    top_qualities: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None
    meeting_time: Optional[str] = None
    status: str
    requested_by: str
    requested_by_name: Optional[str] = None
    created_at: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    admin_notes: Optional[str] = None


def _count_qualities(text: Optional[str]) -> int:
    if not text:
        return 0
    return len([q for q in [t.strip() for t in text.replace("\n", ",").split(",")] if q])


def _ensure_qualities_limit(text: Optional[str]) -> None:
    if text and _count_qualities(text) > 6:
        raise HTTPException(status_code=400, detail="Top qualities can have at most 6 items.")


def _row_to_response(conn, r, requester_name=None) -> EventRequestResponse:
    if requester_name is None:
        q = conn.execute(select(users.c.name).where(users.c.id == r["requested_by"])).mappings().first()
        requester_name = str(q["name"]) if q else None
    return EventRequestResponse(
        id=str(r["id"]),
        event_name=str(r["event_name"]),
        location=str(r["location"]) if r.get("location") else None,
        top_qualities=str(r["top_qualities"]) if r.get("top_qualities") else None,
        description=str(r["description"]) if r.get("description") else None,
        picture=str(r["picture"]) if r.get("picture") else None,
        meeting_time=str(r["meeting_time"]) if r.get("meeting_time") else None,
        status=str(r["status"]),
        requested_by=str(r["requested_by"]),
        requested_by_name=requester_name,
        created_at=str(r["created_at"]),
        reviewed_by=str(r["reviewed_by"]) if r.get("reviewed_by") else None,
        reviewed_at=str(r["reviewed_at"]) if r.get("reviewed_at") else None,
        admin_notes=str(r["admin_notes"]) if r.get("admin_notes") else None,
    )


@router.post("", response_model=EventRequestResponse, status_code=status.HTTP_201_CREATED)
def create_event_request(
    req: CreateEventRequestRequest,
    user: CurrentUser = Depends(get_current_user),
) -> EventRequestResponse:
    rid = new_id()
    now = utcnow_iso()
    _ensure_qualities_limit(req.top_qualities)
    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(event_requests).values(
                id=rid,
                org_id=user.org_id,
                requested_by=user.user_id,
                event_name=req.event_name.strip(),
                location=req.location.strip() if req.location else None,
                top_qualities=req.top_qualities.strip() if req.top_qualities else None,
                description=req.description.strip() if req.description else None,
                picture=req.picture if req.picture else None,
                meeting_time=req.meeting_time.strip() if req.meeting_time else None,
                status="pending",
                created_at=now,
            )
        )
    return EventRequestResponse(
        id=rid,
        event_name=req.event_name.strip(),
        location=req.location.strip() if req.location else None,
        top_qualities=req.top_qualities.strip() if req.top_qualities else None,
        description=req.description.strip() if req.description else None,
        picture=req.picture,
        meeting_time=req.meeting_time.strip() if req.meeting_time else None,
        status="pending",
        requested_by=user.user_id,
        requested_by_name=user.name,
        created_at=now,
        reviewed_by=None,
        reviewed_at=None,
        admin_notes=None,
    )


@router.get("", response_model=list[EventRequestResponse])
def list_event_requests(user: CurrentUser = Depends(get_current_user)) -> list[EventRequestResponse]:
    with get_conn() as conn:
        q = select(event_requests).where(event_requests.c.org_id == user.org_id)
        if user.role != "admin":
            q = q.where(event_requests.c.requested_by == user.user_id)
        q = q.order_by(event_requests.c.created_at.desc())
        rows = conn.execute(q).mappings().all()
        return [_row_to_response(conn, r) for r in rows]


@router.put("/{request_id}", response_model=EventRequestResponse)
def update_event_request(
    request_id: str,
    req: UpdateEventRequestRequest,
    admin: CurrentUser = Depends(require_admin),
) -> EventRequestResponse:
    with get_conn() as conn, conn.begin():
        _ensure_qualities_limit(req.top_qualities)
        row = conn.execute(
            select(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event request not found")
        if str(row["status"]) != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Can only edit pending requests")

        vals = {}
        if req.event_name is not None:
            vals["event_name"] = req.event_name.strip()
        if req.location is not None:
            vals["location"] = req.location.strip() if req.location else None
        if req.top_qualities is not None:
            vals["top_qualities"] = req.top_qualities.strip() if req.top_qualities else None
        if req.description is not None:
            vals["description"] = req.description.strip() if req.description else None
        if req.picture is not None:
            vals["picture"] = req.picture if req.picture else None
        if req.meeting_time is not None:
            vals["meeting_time"] = req.meeting_time.strip() if req.meeting_time else None
        if req.admin_notes is not None:
            vals["admin_notes"] = req.admin_notes.strip() if req.admin_notes else None

        if vals:
            conn.execute(
                update(event_requests).where(
                    event_requests.c.id == request_id,
                    event_requests.c.org_id == admin.org_id,
                ).values(**vals)
            )

        r = conn.execute(
            select(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        return _row_to_response(conn, r)


@router.post("/{request_id}/approve", response_model=ApproveEventResponse)
def approve_event_request(
    request_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> ApproveEventResponse:
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event request not found")
        if str(row["status"]) != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is not pending")

        eid = new_id()
        now = utcnow_iso()
        conn.execute(
            insert(events).values(
                id=eid,
                org_id=admin.org_id,
                event_name=row["event_name"],
                location=row.get("location"),
                top_qualities=row.get("top_qualities"),
                description=row.get("description"),
                picture=row.get("picture"),
                meeting_time=row.get("meeting_time"),
                created_by_user_id=admin.user_id,
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(delete(event_requests).where(event_requests.c.id == request_id))
        return ApproveEventResponse(event_id=eid)


@router.post("/{request_id}/deny", response_model=EventRequestResponse)
def deny_event_request(
    request_id: str,
    req: DenyEventRequestRequest,
    admin: CurrentUser = Depends(require_admin),
) -> EventRequestResponse:
    now = utcnow_iso()
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event request not found")
        if str(row["status"]) != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is not pending")

        conn.execute(
            update(event_requests)
            .where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == admin.org_id,
            )
            .values(
                status="denied",
                reviewed_by=admin.user_id,
                reviewed_at=now,
                admin_notes=req.admin_notes.strip() if req.admin_notes and req.admin_notes.strip() else None,
            )
        )

    with get_conn() as conn:
        r = conn.execute(
            select(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        return _row_to_response(conn, r)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_request(
    request_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete an event request (admin or owner)."""
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Event request not found")
        if user.role != "admin" and str(row["requested_by"]) != user.user_id:
            raise HTTPException(status_code=403, detail="You can only delete your own requests")
        conn.execute(
            delete(event_requests).where(
                event_requests.c.id == request_id,
                event_requests.c.org_id == user.org_id,
            )
        )
