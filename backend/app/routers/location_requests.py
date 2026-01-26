# app/routers/location_requests.py
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update

from app.db import get_conn, location_requests, locations, new_id, utcnow_iso
from app.deps import CurrentUser, get_current_user, require_admin
from app.routers.locations import (
    LocationPicture,
    _ensure_qualities_limit,
    _parse_pictures_json,
    _serialize_pictures,
)

router = APIRouter(prefix="/location-requests", tags=["location-requests"])

RequestStatus = Literal["pending", "submitted", "approved", "denied"]


# ===============================
# Models
# ===============================
class LocationRequestBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1)  # Complete address
    pictures: Optional[list[LocationPicture]] = None
    description: Optional[str] = None
    most_known_for: Optional[str] = None
    level_of_business: Optional[Literal["high", "moderate", "low"]] = None


class CreateLocationRequest(LocationRequestBase):
    pass


class LocationRequestResponse(BaseModel):
    id: str
    name: str
    address: str
    pictures: Optional[list[LocationPicture]] = None
    description: Optional[str] = None
    most_known_for: Optional[str] = None
    level_of_business: Optional[str] = None
    requested_by: str
    requested_by_name: str
    requested_by_email: str
    status: RequestStatus
    admin_notes: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[str] = None
    created_at: str


class ApproveRequestRequest(BaseModel):
    admin_notes: Optional[str] = None


class ApproveLocationResponse(BaseModel):
    location_id: str
    message: str = "Location created and request marked as approved."


class DenyRequestRequest(BaseModel):
    admin_notes: str = Field(..., min_length=1, description="Reason for denial (required)")


class UpdateStatusRequest(BaseModel):
    status: RequestStatus = Field(..., description="New status")
    admin_notes: Optional[str] = None


class UpdateLocationRequestRequest(LocationRequestBase):
    admin_notes: Optional[str] = None


# ===============================
# Student: Create request
# ===============================
@router.post("", response_model=LocationRequestResponse, status_code=status.HTTP_201_CREATED)
def create_location_request(
    req: CreateLocationRequest,
    user: CurrentUser = Depends(get_current_user),
) -> LocationRequestResponse:
    """
    Students can request a new location to be added to the application.
    """
    request_id = new_id()
    now = utcnow_iso()
    _ensure_qualities_limit(req.most_known_for)

    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(location_requests).values(
                id=request_id,
                org_id=user.org_id,
                name=req.name.strip(),
                address=req.address.strip(),
                pictures=_serialize_pictures(req.pictures),
                description=req.description.strip() if req.description else None,
                most_known_for=req.most_known_for.strip() if req.most_known_for else None,
                level_of_business=req.level_of_business,
                requested_by=user.user_id,
                status="pending",
                admin_notes=None,
                reviewed_by=None,
                reviewed_at=None,
                created_at=now,
            )
        )

    return LocationRequestResponse(
        id=request_id,
        name=req.name.strip(),
        address=req.address.strip(),
        pictures=req.pictures,
        description=req.description.strip() if req.description else None,
        most_known_for=req.most_known_for.strip() if req.most_known_for else None,
        level_of_business=req.level_of_business,
        requested_by=user.user_id,
        requested_by_name=user.name,
        requested_by_email=user.email,
        status="pending",
        admin_notes=None,
        reviewed_by=None,
        reviewed_by_name=None,
        reviewed_at=None,
        created_at=now,
    )


# ===============================
# List requests (student: own only, admin: org)
# ===============================
@router.get("", response_model=list[LocationRequestResponse])
def list_location_requests(
    status_filter: Optional[RequestStatus] = Query(None, description="Filter by status"),
    my_requests_only: bool = Query(False, description="Show only my requests (students)"),
    user: CurrentUser = Depends(get_current_user),
) -> list[LocationRequestResponse]:
    """
    List location requests.
    Students see only their own requests.
    Admins see all requests in their organization (or can set my_requests_only=true).
    """
    from app.db import users

    with get_conn() as conn:
        query = select(location_requests).where(location_requests.c.org_id == user.org_id)

        if user.role != "admin" or my_requests_only:
            query = query.where(location_requests.c.requested_by == user.user_id)

        if status_filter:
            query = query.where(location_requests.c.status == status_filter)

        rows = conn.execute(query.order_by(location_requests.c.created_at.desc())).mappings().all()

        result: list[LocationRequestResponse] = []
        for row in rows:
            requester_row = conn.execute(
                select(users.c.name, users.c.email).where(users.c.id == row["requested_by"])
            ).mappings().first()

            reviewer_row = None
            if row["reviewed_by"]:
                reviewer_row = conn.execute(
                    select(users.c.name).where(users.c.id == row["reviewed_by"])
                ).mappings().first()

            result.append(
                LocationRequestResponse(
                    id=str(row["id"]),
                    name=str(row["name"]),
                    address=str(row["address"]),
                    pictures=_parse_pictures_json(row["pictures"]),
                    description=str(row["description"]) if row.get("description") else None,
                    most_known_for=str(row["most_known_for"]) if row["most_known_for"] else None,
                    level_of_business=str(row["level_of_business"]) if row["level_of_business"] else None,
                    requested_by=str(row["requested_by"]),
                    requested_by_name=str(requester_row["name"]) if requester_row else "Unknown",
                    requested_by_email=str(requester_row["email"]) if requester_row else "Unknown",
                    status=str(row["status"]),
                    admin_notes=str(row["admin_notes"]) if row["admin_notes"] else None,
                    reviewed_by=str(row["reviewed_by"]) if row["reviewed_by"] else None,
                    reviewed_by_name=str(reviewer_row["name"]) if reviewer_row else None,
                    reviewed_at=str(row["reviewed_at"]) if row["reviewed_at"] else None,
                    created_at=str(row["created_at"]),
                )
            )

        return result


# ===============================
# Admin: Approve (create location + mark approved; do NOT delete request)
# ===============================
@router.put("/{request_id}/approve", response_model=ApproveLocationResponse)
def approve_location_request(
    request_id: str,
    req: ApproveRequestRequest,
    admin: CurrentUser = Depends(require_admin),
) -> ApproveLocationResponse:
    """
    Admin-only: create a Location from the request, then mark the request approved.
    """
    with get_conn() as conn, conn.begin():
        request_row = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        if not request_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location request not found")

        if str(request_row["status"]) not in ["pending", "submitted"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Request has already been {request_row['status']}",
            )

        location_id = new_id()
        now = utcnow_iso()

        # Create the location from the request
        conn.execute(
            insert(locations).values(
                id=location_id,
                org_id=admin.org_id,
                name=str(request_row["name"]),
                address=str(request_row["address"]),
                pictures=request_row["pictures"],  # already JSON text
                rating="0.0",
                reviews_count="0",
                description=request_row.get("description"),
                most_known_for=request_row["most_known_for"],
                level_of_business=request_row["level_of_business"],
                created_by=admin.user_id,
                is_active=True,
                created_at=now,
                updated_at=None,
            )
        )

        # Mark request approved
        conn.execute(
            update(location_requests)
            .where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
            .values(
                status="approved",
                admin_notes=req.admin_notes.strip() if req.admin_notes else None,
                reviewed_by=admin.user_id,
                reviewed_at=now,
            )
        )

        return ApproveLocationResponse(location_id=location_id)


# ===============================
# Admin: Deny
# ===============================
@router.put("/{request_id}/deny", response_model=LocationRequestResponse)
def deny_location_request(
    request_id: str,
    req: DenyRequestRequest,
    admin: CurrentUser = Depends(require_admin),
) -> LocationRequestResponse:
    """
    Admin-only endpoint to deny a location request with a reason.
    """
    from app.db import users

    with get_conn() as conn, conn.begin():
        request_row = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        if not request_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location request not found")

        if str(request_row["status"]) not in ["pending", "submitted"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Request has already been {request_row['status']}",
            )

        now = utcnow_iso()

        conn.execute(
            update(location_requests)
            .where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
            .values(
                status="denied",
                admin_notes=req.admin_notes.strip(),
                reviewed_by=admin.user_id,
                reviewed_at=now,
            )
        )

        updated_row = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        requester_row = conn.execute(
            select(users.c.name, users.c.email).where(users.c.id == updated_row["requested_by"])
        ).mappings().first()

        reviewer_row = conn.execute(
            select(users.c.name).where(users.c.id == admin.user_id)
        ).mappings().first()

        return LocationRequestResponse(
            id=str(updated_row["id"]),
            name=str(updated_row["name"]),
            address=str(updated_row["address"]),
            pictures=_parse_pictures_json(updated_row["pictures"]),
            description=str(updated_row["description"]) if updated_row.get("description") else None,
            most_known_for=str(updated_row["most_known_for"]) if updated_row["most_known_for"] else None,
            level_of_business=str(updated_row["level_of_business"]) if updated_row["level_of_business"] else None,
            requested_by=str(updated_row["requested_by"]),
            requested_by_name=str(requester_row["name"]) if requester_row else "Unknown",
            requested_by_email=str(requester_row["email"]) if requester_row else "Unknown",
            status="denied",
            admin_notes=str(updated_row["admin_notes"]) if updated_row["admin_notes"] else None,
            reviewed_by=str(updated_row["reviewed_by"]) if updated_row["reviewed_by"] else None,
            reviewed_by_name=str(reviewer_row["name"]) if reviewer_row else admin.name,
            reviewed_at=str(updated_row["reviewed_at"]) if updated_row["reviewed_at"] else None,
            created_at=str(updated_row["created_at"]),
        )


# ===============================
# Admin: Update status (generic)
# ===============================
@router.put("/{request_id}/status", response_model=LocationRequestResponse)
def update_request_status(
    request_id: str,
    req: UpdateStatusRequest,
    admin: CurrentUser = Depends(require_admin),
) -> LocationRequestResponse:
    """
    Admin-only endpoint to update request status to any value.
    """
    from app.db import users

    with get_conn() as conn, conn.begin():
        existing = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location request not found")

        now = utcnow_iso()

        update_values: dict[str, object] = {
            "status": req.status,
            "reviewed_by": admin.user_id,
            "reviewed_at": now,
        }
        if req.admin_notes is not None:
            update_values["admin_notes"] = req.admin_notes.strip() if req.admin_notes else None

        conn.execute(
            update(location_requests)
            .where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
            .values(**update_values)
        )

        updated_row = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        requester_row = conn.execute(
            select(users.c.name, users.c.email).where(users.c.id == updated_row["requested_by"])
        ).mappings().first()

        reviewer_row = conn.execute(
            select(users.c.name).where(users.c.id == admin.user_id)
        ).mappings().first()

        return LocationRequestResponse(
            id=str(updated_row["id"]),
            name=str(updated_row["name"]),
            address=str(updated_row["address"]),
            pictures=_parse_pictures_json(updated_row["pictures"]),
            description=str(updated_row["description"]) if updated_row.get("description") else None,
            most_known_for=str(updated_row["most_known_for"]) if updated_row["most_known_for"] else None,
            level_of_business=str(updated_row["level_of_business"]) if updated_row["level_of_business"] else None,
            requested_by=str(updated_row["requested_by"]),
            requested_by_name=str(requester_row["name"]) if requester_row else "Unknown",
            requested_by_email=str(requester_row["email"]) if requester_row else "Unknown",
            status=str(updated_row["status"]),
            admin_notes=str(updated_row["admin_notes"]) if updated_row["admin_notes"] else None,
            reviewed_by=str(updated_row["reviewed_by"]) if updated_row["reviewed_by"] else None,
            reviewed_by_name=str(reviewer_row["name"]) if reviewer_row else admin.name,
            reviewed_at=str(updated_row["reviewed_at"]) if updated_row["reviewed_at"] else None,
            created_at=str(updated_row["created_at"]),
        )


# ===============================
# Admin: Update request fields
# ===============================
@router.put("/{request_id}", response_model=LocationRequestResponse)
def update_location_request(
    request_id: str,
    req: UpdateLocationRequestRequest,
    admin: CurrentUser = Depends(require_admin),
) -> LocationRequestResponse:
    """
    Admin-only endpoint to update location request details (NOT status).
    """
    from app.db import users

    with get_conn() as conn, conn.begin():
        existing = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location request not found")

        _ensure_qualities_limit(req.most_known_for)

        conn.execute(
            update(location_requests)
            .where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
            .values(
                name=req.name.strip(),
                address=req.address.strip(),
                pictures=_serialize_pictures(req.pictures),
                description=req.description.strip() if req.description else None,
                most_known_for=req.most_known_for.strip() if req.most_known_for else None,
                level_of_business=req.level_of_business,
                admin_notes=req.admin_notes.strip() if req.admin_notes else None,
            )
        )

        updated_row = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == admin.org_id,
            )
        ).mappings().first()

        requester_row = conn.execute(
            select(users.c.name, users.c.email).where(users.c.id == updated_row["requested_by"])
        ).mappings().first()

        reviewer_row = None
        if updated_row["reviewed_by"]:
            reviewer_row = conn.execute(
                select(users.c.name).where(users.c.id == updated_row["reviewed_by"])
            ).mappings().first()

        return LocationRequestResponse(
            id=str(updated_row["id"]),
            name=str(updated_row["name"]),
            address=str(updated_row["address"]),
            pictures=_parse_pictures_json(updated_row["pictures"]),
            description=str(updated_row["description"]) if updated_row.get("description") else None,
            most_known_for=str(updated_row["most_known_for"]) if updated_row["most_known_for"] else None,
            level_of_business=str(updated_row["level_of_business"]) if updated_row["level_of_business"] else None,
            requested_by=str(updated_row["requested_by"]),
            requested_by_name=str(requester_row["name"]) if requester_row else "Unknown",
            requested_by_email=str(requester_row["email"]) if requester_row else "Unknown",
            status=str(updated_row["status"]),
            admin_notes=str(updated_row["admin_notes"]) if updated_row["admin_notes"] else None,
            reviewed_by=str(updated_row["reviewed_by"]) if updated_row["reviewed_by"] else None,
            reviewed_by_name=str(reviewer_row["name"]) if reviewer_row else None,
            reviewed_at=str(updated_row["reviewed_at"]) if updated_row["reviewed_at"] else None,
            created_at=str(updated_row["created_at"]),
        )


# ===============================
# Delete request (hard delete)
# ===============================
@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location_request(
    request_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """
    Delete a location request.
    Students can only delete their own requests (hard delete).
    Admins can delete any request in their organization.
    """
    with get_conn() as conn, conn.begin():
        request_row = conn.execute(
            select(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == user.org_id,
            )
        ).mappings().first()

        if not request_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location request not found")

        if user.role != "admin" and str(request_row["requested_by"]) != user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own requests")

        conn.execute(
            delete(location_requests).where(
                location_requests.c.id == request_id,
                location_requests.c.org_id == user.org_id,
            )
        )
