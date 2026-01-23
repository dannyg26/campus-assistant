# app/routers/locations.py
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, validator
from sqlalchemy import select, insert, desc

from app.db import get_conn, locations, location_activity_ratings, new_id, reviews, utcnow_iso
from app.deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/locations", tags=["locations"])


class LocationPicture(BaseModel):
    url: str
    caption: Optional[str] = None


class LocationBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1)  # Complete address
    pictures: Optional[list[LocationPicture]] = None
    description: Optional[str] = None
    most_known_for: Optional[str] = None
    level_of_business: Optional[Literal["high", "moderate", "low"]] = None

    @validator("pictures", pre=True)
    def _normalize_pictures(cls, value):
        if value is None:
            return value
        if isinstance(value, list):
            normalized = []
            for item in value:
                if isinstance(item, LocationPicture):
                    normalized.append(item)
                elif isinstance(item, str):
                    normalized.append({"url": item})
                elif isinstance(item, dict):
                    normalized.append(item)
            return normalized
        return value


class LocationResponse(BaseModel):
    id: str
    name: str
    address: str
    pictures: Optional[list[LocationPicture]] = None
    rating: float
    reviews_count: int
    description: Optional[str] = None
    most_known_for: Optional[str] = None
    level_of_business: Optional[str] = None
    created_by: str
    created_at: str
    updated_at: Optional[str] = None


class CreateLocationRequest(LocationBase):
    pass


class CreateLocationResponse(LocationResponse):
    pass


class UpdateLocationRequest(LocationBase):
    pass


def _parse_pictures_json(pictures_json: Optional[str]) -> Optional[list[LocationPicture]]:
    """Parse pictures JSON string to list of LocationPicture objects."""
    if not pictures_json:
        return None
    try:
        data = json.loads(pictures_json)
        if not isinstance(data, list):
            return None
        normalized: list[LocationPicture] = []
        for item in data:
            if isinstance(item, dict):
                normalized.append(LocationPicture(**item))
            elif isinstance(item, str):
                normalized.append(LocationPicture(url=item))
        return normalized or None
    except Exception:
        return None


def _serialize_pictures(pictures: Optional[list[LocationPicture]]) -> Optional[str]:
    """Serialize list of LocationPicture to JSON string."""
    if not pictures:
        return None
    try:
        data = []
        for pic in pictures:
            if isinstance(pic, LocationPicture):
                data.append(pic.dict(exclude_none=True))
            elif isinstance(pic, dict):
                url = pic.get("url")
                if isinstance(url, str) and url:
                    data.append({k: v for k, v in pic.items() if v is not None})
            elif isinstance(pic, str):
                data.append({"url": pic})
        return json.dumps(data) if data else None
    except Exception:
        return None


def _count_qualities(text: Optional[str]) -> int:
    if not text:
        return 0
    return len([q for q in [t.strip() for t in text.replace("\n", ",").split(",")] if q])


def _ensure_qualities_limit(text: Optional[str]) -> None:
    if text and _count_qualities(text) > 6:
        raise HTTPException(status_code=400, detail="Top qualities can have at most 6 items.")


@router.get("", response_model=list[LocationResponse])
def list_locations(
    search: Optional[str] = Query(None, description="Search by name or address"),
    level_of_business: Optional[Literal["high", "moderate", "low"]] = Query(None, description="Filter by business level"),
    min_rating: Optional[float] = Query(None, ge=0, le=5, description="Minimum rating"),
    created_since_hours: Optional[float] = Query(None, description="Only locations created in the last N hours (e.g. 48 for 2 days)"),
    sort: Optional[Literal["recent", "activity"]] = Query(None, description="recent=created_at desc, activity=most reviews+activity_ratings in window"),
    activity_since_hours: Optional[float] = Query(48, description="Hours window for activity count when sort=activity"),
    user: CurrentUser = Depends(get_current_user),
) -> list[LocationResponse]:
    """
    List all active locations in the user's organization.
    Students and admins can both use this endpoint.
    """
    from sqlalchemy import select, func, and_

    with get_conn() as conn:
        query = select(
            locations.c.id,
            locations.c.name,
            locations.c.address,
            locations.c.pictures,
            locations.c.rating,
            locations.c.reviews_count,
            locations.c.description,
            locations.c.most_known_for,
            locations.c.level_of_business,
            locations.c.created_by,
            locations.c.created_at,
            locations.c.updated_at,
        ).where(
            locations.c.org_id == user.org_id,
            locations.c.is_active == True,  # noqa: E712
        )

        if created_since_hours is not None and created_since_hours > 0:
            since = (datetime.now(timezone.utc) - timedelta(hours=created_since_hours)).isoformat()
            query = query.where(locations.c.created_at >= since)

        # Apply search filter
        if search:
            search_term = f"%{search.lower()}%"
            query = query.where(
                (func.lower(locations.c.name).like(search_term))
                | (func.lower(locations.c.address).like(search_term))
            )

        # Apply business level filter
        if level_of_business:
            query = query.where(locations.c.level_of_business == level_of_business)

        # Apply rating filter
        if min_rating is not None:
            query = query.where(cast(locations.c.rating, float) >= min_rating)

        if sort == "activity":
            since = (datetime.now(timezone.utc) - timedelta(hours=activity_since_hours or 48)).isoformat()
            rev = select(func.count()).select_from(reviews).where(
                reviews.c.location_id == locations.c.id,
                reviews.c.created_at >= since,
                reviews.c.deleted_at.is_(None),
            ).scalar_subquery()
            ar = select(func.count()).select_from(location_activity_ratings).where(location_activity_ratings.c.location_id == locations.c.id, location_activity_ratings.c.created_at >= since).scalar_subquery()
            query = query.order_by((rev + ar).desc())
        elif sort == "recent" or (created_since_hours is not None and sort is None):
            query = query.order_by(locations.c.created_at.desc())
        else:
            query = query.order_by(locations.c.name.asc())
        rows = conn.execute(query).mappings().all()

        result = []
        for row in rows:
            result.append(
                LocationResponse(
                    id=str(row["id"]),
                    name=str(row["name"]),
                    address=str(row["address"]),
                    pictures=_parse_pictures_json(row["pictures"]),
                    rating=float(row["rating"] or "0.0"),
                    reviews_count=int(row["reviews_count"] or "0"),
                    description=str(row["description"]) if row.get("description") else None,
                    most_known_for=str(row["most_known_for"]) if row["most_known_for"] else None,
                    level_of_business=str(row["level_of_business"]) if row["level_of_business"] else None,
                    created_by=str(row["created_by"]),
                    created_at=str(row["created_at"]),
                    updated_at=str(row["updated_at"]) if row["updated_at"] else None,
                )
            )

    return result


@router.get("/{location_id}", response_model=LocationResponse)
def get_location(
    location_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> LocationResponse:
    """Get a specific location by ID."""
    from sqlalchemy import select

    with get_conn() as conn:
        row = conn.execute(
            select(locations).where(
                locations.c.id == location_id,
                locations.c.org_id == user.org_id,
                locations.c.is_active == True,  # noqa: E712
            )
        ).mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )

        return LocationResponse(
            id=str(row["id"]),
            name=str(row["name"]),
            address=str(row["address"]),
            pictures=_parse_pictures_json(row["pictures"]),
            rating=float(row["rating"] or "0.0"),
            reviews_count=int(row["reviews_count"] or "0"),
            description=str(row["description"]) if row.get("description") else None,
            most_known_for=str(row["most_known_for"]) if row["most_known_for"] else None,
            level_of_business=str(row["level_of_business"]) if row["level_of_business"] else None,
            created_by=str(row["created_by"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]) if row["updated_at"] else None,
        )


# ---- Activity ratings (rate level of activity; 2h cooldown)

COOLDOWN_HOURS = 2
GRAPH_HOURS = 24


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class ActivityRatingsResponse(BaseModel):
    ratings: list[dict]  # [{ "level": str, "created_at": str }]
    can_rate: bool
    cooldown_until: Optional[str] = None  # ISO when user can rate again


class SubmitActivityRatingRequest(BaseModel):
    level: Literal["low", "moderate", "high"]


@router.get("/{location_id}/activity-ratings", response_model=ActivityRatingsResponse)
def get_activity_ratings(
    location_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> ActivityRatingsResponse:
    """Get activity ratings for the last 24h (for graph) and current user's can_rate/cooldown."""
    import logging
    log = logging.getLogger(__name__)
    try:
        with get_conn() as conn:
            loc = conn.execute(
                select(locations).where(
                    locations.c.id == location_id,
                    locations.c.org_id == user.org_id,
                    locations.c.is_active == True,  # noqa: E712
                )
            ).mappings().first()
            if not loc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

            now = datetime.now(timezone.utc)
            since = now - timedelta(hours=GRAPH_HOURS)
            since_s = since.isoformat()

            rows = conn.execute(
                select(location_activity_ratings.c.level, location_activity_ratings.c.created_at)
                .where(
                    location_activity_ratings.c.location_id == location_id,
                    location_activity_ratings.c.created_at >= since_s,
                )
                .order_by(location_activity_ratings.c.created_at.asc())
            ).mappings().all()

            ratings = [{"level": r["level"], "created_at": r["created_at"]} for r in rows]

            last = conn.execute(
                select(location_activity_ratings.c.created_at)
                .where(
                    location_activity_ratings.c.location_id == location_id,
                    location_activity_ratings.c.user_id == user.user_id,
                )
                .order_by(desc(location_activity_ratings.c.created_at))
                .limit(1)
            ).mappings().first()

            can_rate = True
            cooldown_until: Optional[str] = None
            if last:
                created = _parse_iso(last["created_at"])
                until = created + timedelta(hours=COOLDOWN_HOURS)
                if now < until:
                    can_rate = False
                    cooldown_until = until.isoformat()

        return ActivityRatingsResponse(ratings=ratings, can_rate=can_rate, cooldown_until=cooldown_until)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("get_activity_ratings failed: %s", e)
        return ActivityRatingsResponse(ratings=[], can_rate=True, cooldown_until=None)


@router.post("/{location_id}/activity-ratings", status_code=status.HTTP_201_CREATED)
def submit_activity_rating(
    location_id: str,
    req: SubmitActivityRatingRequest,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Submit a rate-of-activity. 2h cooldown per user per location."""
    import logging
    log = logging.getLogger(__name__)
    try:
        with get_conn() as conn, conn.begin():
            loc = conn.execute(
                select(locations).where(
                    locations.c.id == location_id,
                    locations.c.org_id == user.org_id,
                    locations.c.is_active == True,  # noqa: E712
                )
            ).mappings().first()
            if not loc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

            last = conn.execute(
                select(location_activity_ratings.c.created_at)
                .where(
                    location_activity_ratings.c.location_id == location_id,
                    location_activity_ratings.c.user_id == user.user_id,
                )
                .order_by(desc(location_activity_ratings.c.created_at))
                .limit(1)
            ).mappings().first()

            now = datetime.now(timezone.utc)
            if last:
                created = _parse_iso(last["created_at"])
                until = created + timedelta(hours=COOLDOWN_HOURS)
                if now < until:
                    secs = max(0, int((until - now).total_seconds()))
                    total_mins = max(1, (secs + 59) // 60)
                    hrs, mins = total_mins // 60, total_mins % 60
                    if hrs > 0 and mins > 0:
                        detail = f"You can rate again in {hrs} hour{'s' if hrs != 1 else ''} and {mins} minute{'s' if mins != 1 else ''}."
                    elif hrs > 0:
                        detail = f"You can rate again in {hrs} hour{'s' if hrs != 1 else ''}."
                    else:
                        detail = f"You can rate again in {mins} minute{'s' if mins != 1 else ''}."
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail=detail,
                    )

            rid = new_id()
            now_s = now.isoformat()
            conn.execute(
                insert(location_activity_ratings).values(
                    id=rid,
                    location_id=location_id,
                    user_id=user.user_id,
                    level=req.level,
                    created_at=now_s,
                )
            )

        return {"level": req.level, "created_at": now_s}
    except HTTPException:
        raise
    except Exception as e:
        log.exception("submit_activity_rating failed: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.post("", response_model=CreateLocationResponse, status_code=status.HTTP_201_CREATED)
def create_location(
    req: CreateLocationRequest,
    user: CurrentUser = Depends(get_current_user),
) -> CreateLocationResponse:
    """
    Students and admins can create a new location directly.
    """
    from sqlalchemy import insert

    location_id = new_id()
    now = utcnow_iso()
    _ensure_qualities_limit(req.most_known_for)

    with get_conn() as conn, conn.begin():
        conn.execute(
            insert(locations).values(
                id=location_id,
                org_id=user.org_id,
                name=req.name.strip(),
                address=req.address.strip(),
                pictures=_serialize_pictures(req.pictures),
                rating="0.0",
                reviews_count="0",
                description=req.description.strip() if req.description else None,
                most_known_for=req.most_known_for.strip() if req.most_known_for else None,
                level_of_business=req.level_of_business,
                created_by=user.user_id,
                is_active=True,
                created_at=now,
                updated_at=None,
            )
        )

    return CreateLocationResponse(
        id=location_id,
        name=req.name.strip(),
        address=req.address.strip(),
        pictures=req.pictures,
        rating=0.0,
        reviews_count=0,
        description=req.description,
        most_known_for=req.most_known_for,
        level_of_business=req.level_of_business,
        created_by=user.user_id,
        created_at=now,
        updated_at=None,
    )


@router.put("/{location_id}", response_model=LocationResponse)
def update_location(
    location_id: str,
    req: UpdateLocationRequest,
    admin: CurrentUser = Depends(require_admin),
) -> LocationResponse:
    """
    Admin-only endpoint to update a location.
    """
    from sqlalchemy import select, update

    with get_conn() as conn, conn.begin():
        # Verify location exists and belongs to org
        row = conn.execute(
            select(locations).where(
                locations.c.id == location_id,
                locations.c.org_id == admin.org_id,
            )
        ).mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )

        _ensure_qualities_limit(req.most_known_for)
        # Update location
        now = utcnow_iso()
        conn.execute(
            update(locations)
            .where(locations.c.id == location_id)
            .values(
                name=req.name.strip(),
                address=req.address.strip(),
                pictures=_serialize_pictures(req.pictures),
                description=req.description.strip() if req.description else None,
                most_known_for=req.most_known_for.strip() if req.most_known_for else None,
                level_of_business=req.level_of_business,
                updated_at=now,
            )
        )

        # Fetch updated location
        updated_row = conn.execute(
            select(locations).where(locations.c.id == location_id)
        ).mappings().first()

        return LocationResponse(
            id=str(updated_row["id"]),
            name=str(updated_row["name"]),
            address=str(updated_row["address"]),
            pictures=_parse_pictures_json(updated_row["pictures"]),
            rating=float(updated_row["rating"] or "0.0"),
            reviews_count=int(updated_row["reviews_count"] or "0"),
            description=str(updated_row["description"]) if updated_row.get("description") else None,
            most_known_for=str(updated_row["most_known_for"]) if updated_row["most_known_for"] else None,
            level_of_business=str(updated_row["level_of_business"]) if updated_row["level_of_business"] else None,
            created_by=str(updated_row["created_by"]),
            created_at=str(updated_row["created_at"]),
            updated_at=str(updated_row["updated_at"]) if updated_row["updated_at"] else None,
        )


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    location_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> None:
    """
    Admin-only endpoint to soft delete a location.
    """
    from sqlalchemy import update

    with get_conn() as conn, conn.begin():
        result = conn.execute(
            update(locations)
            .where(
                locations.c.id == location_id,
                locations.c.org_id == admin.org_id,
            )
            .values(is_active=False)
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )
