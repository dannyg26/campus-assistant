# app/routers/announcement_requests.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select

from app.db import (
    get_conn,
    announcement_requests,
    announcements,
    users,
    new_id,
    utcnow_iso,
)
from app.deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/announcement-requests", tags=["announcement-requests"])


class CreateAnnouncementRequestRequest(BaseModel):
    title: str = Field(min_length=1, max_length=20)
    body: str = Field(min_length=1)
    image: Optional[str] = None


class DenyRequest(BaseModel):
    admin_notes: Optional[str] = None


class ApproveAnnouncementResponse(BaseModel):
    announcement_id: str
    message: str = "Announcement created and request removed."


class AnnouncementRequestResponse(BaseModel):
    id: str
    org_id: str
    requested_by: str
    requested_by_name: Optional[str] = None
    title: str
    body: str
    image: Optional[str] = None
    status: str
    created_at: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    admin_notes: Optional[str] = None


@router.post("", response_model=AnnouncementRequestResponse, status_code=status.HTTP_201_CREATED)
def create_announcement_request(
    req: CreateAnnouncementRequestRequest,
    user: CurrentUser = Depends(get_current_user),
) -> AnnouncementRequestResponse:
    """Students and admins can submit an announcement request."""
    rid = new_id()
    now = utcnow_iso()
    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(announcement_requests).values(
                id=rid,
                org_id=user.org_id,
                requested_by=user.user_id,
                title=req.title.strip(),
                body=req.body.strip(),
                image=req.image if req.image else None,
                status="pending",
                created_at=now,
                reviewed_by=None,
                reviewed_at=None,
                admin_notes=None,
            )
        )
    return AnnouncementRequestResponse(
        id=rid,
        org_id=user.org_id,
        requested_by=user.user_id,
        requested_by_name=user.name,
        title=req.title.strip(),
        body=req.body.strip(),
        image=req.image,
        status="pending",
        created_at=now,
        reviewed_by=None,
        reviewed_at=None,
        admin_notes=None,
    )


@router.get("", response_model=list[AnnouncementRequestResponse])
def list_announcement_requests(
    user: CurrentUser = Depends(get_current_user),
) -> list[AnnouncementRequestResponse]:
    """Admin: all for org. Student: own only."""
    with get_conn() as conn:
        q = select(announcement_requests).where(announcement_requests.c.org_id == user.org_id)
        if user.role != "admin":
            q = q.where(announcement_requests.c.requested_by == user.user_id)
        q = q.order_by(announcement_requests.c.created_at.desc())
        rows = conn.execute(q).mappings().all()

        out = []
        for r in rows:
            requester = conn.execute(
                select(users.c.name).where(users.c.id == r["requested_by"])
            ).mappings().first()
            out.append(
                AnnouncementRequestResponse(
                    id=str(r["id"]),
                    org_id=str(r["org_id"]),
                    requested_by=str(r["requested_by"]),
                    requested_by_name=str(requester["name"]) if requester else None,
                    title=str(r["title"]),
                    body=str(r["body"]),
                    image=str(r["image"]) if r.get("image") else None,
                    status=str(r["status"]),
                    created_at=str(r["created_at"]),
                    reviewed_by=str(r["reviewed_by"]) if r.get("reviewed_by") else None,
                    reviewed_at=str(r["reviewed_at"]) if r.get("reviewed_at") else None,
                    admin_notes=str(r["admin_notes"]) if r.get("admin_notes") else None,
                )
            )
        return out


@router.post("/{request_id}/approve", response_model=ApproveAnnouncementResponse)
def approve_announcement_request(
    request_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> ApproveAnnouncementResponse:
    """Admin: create a published announcement from the request and remove it from requests."""
    now = utcnow_iso()
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcement_requests).where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        if str(row["status"]) != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending")

        aid = new_id()
        conn.execute(
            insert(announcements).values(
                id=aid,
                org_id=admin.org_id,
                title=row["title"],
                body=row["body"],
                image=row["image"],
                status="published",
                created_by_user_id=admin.user_id,
                created_at=now,
                updated_at=now,
                published_at=now,
            )
        )
        conn.execute(
            delete(announcement_requests).where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == admin.org_id,
            )
        )

    return ApproveAnnouncementResponse(announcement_id=aid)


@router.post("/{request_id}/deny", response_model=AnnouncementRequestResponse)
def deny_announcement_request(
    request_id: str,
    body: DenyRequest,
    admin: CurrentUser = Depends(require_admin),
) -> AnnouncementRequestResponse:
    """Admin: mark request as denied."""
    now = utcnow_iso()
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcement_requests).where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        if str(row["status"]) != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending")

        conn.execute(
            update(announcement_requests)
            .where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == admin.org_id,
            )
            .values(
                status="denied",
                reviewed_by=admin.user_id,
                reviewed_at=now,
                admin_notes=body.admin_notes.strip() if body.admin_notes and body.admin_notes.strip() else None,
            )
        )

    with get_conn() as conn:
        r = conn.execute(
            select(announcement_requests).where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()
        requester = conn.execute(
            select(users.c.name).where(users.c.id == r["requested_by"])
        ).mappings().first()
        return AnnouncementRequestResponse(
            id=str(r["id"]),
            org_id=str(r["org_id"]),
            requested_by=str(r["requested_by"]),
            requested_by_name=str(requester["name"]) if requester else None,
            title=str(r["title"]),
            body=str(r["body"]),
            image=str(r["image"]) if r.get("image") else None,
            status=str(r["status"]),
            created_at=str(r["created_at"]),
            reviewed_by=str(r["reviewed_by"]) if r.get("reviewed_by") else None,
            reviewed_at=str(r["reviewed_at"]) if r.get("reviewed_at") else None,
            admin_notes=str(r["admin_notes"]) if r.get("admin_notes") else None,
        )


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement_request(
    request_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete an announcement request (admin or owner)."""
    with get_conn() as conn, conn.begin():
        row = conn.execute(
            select(announcement_requests).where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == user.org_id,
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        if user.role != "admin" and str(row["requested_by"]) != user.user_id:
            raise HTTPException(status_code=403, detail="You can only delete your own requests")
        conn.execute(
            delete(announcement_requests).where(
                announcement_requests.c.id == request_id,
                announcement_requests.c.org_id == user.org_id,
            )
        )
