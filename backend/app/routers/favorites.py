# app/routers/favorites.py
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, insert, select

from app.db import (
    get_conn,
    locations,
    new_id,
    user_favorites,
    utcnow_iso,
)
from app.deps import CurrentUser, get_current_user

router = APIRouter(prefix="/favorites", tags=["favorites"])


class LocationPicture(BaseModel):
    url: str
    caption: Optional[str] = None


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


def _parse_pictures_json(pictures_json: Optional[str]) -> Optional[list[LocationPicture]]:
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


def _row_to_location_response(row) -> LocationResponse:
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


@router.get("", response_model=list[LocationResponse])
def list_favorites(user: CurrentUser = Depends(get_current_user)) -> list[LocationResponse]:
    """List the current user's favorite locations (same shape as locations list)."""
    with get_conn() as conn:
        query = (
            select(
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
            )
            .select_from(
                user_favorites.join(
                    locations,
                    (user_favorites.c.location_id == locations.c.id)
                    & (locations.c.org_id == user.org_id)
                    & (locations.c.is_active == True),  # noqa: E712
                )
            )
            .where(user_favorites.c.user_id == user.user_id)
            .order_by(locations.c.name.asc())
        )
        rows = conn.execute(query).mappings().all()
        return [_row_to_location_response(r) for r in rows]


@router.post("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_favorite(
    location_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Add a location to the current user's favorites. Location must exist and be in user's org."""
    with get_conn() as conn:
        with conn.begin():
            loc = conn.execute(
                select(locations).where(
                    locations.c.id == location_id,
                    locations.c.org_id == user.org_id,
                    locations.c.is_active == True,  # noqa: E712
                )
            ).mappings().first()
            if not loc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

            existing = conn.execute(
                select(user_favorites).where(
                    user_favorites.c.user_id == user.user_id,
                    user_favorites.c.location_id == location_id,
                )
            ).mappings().first()
            if existing:
                return

            fid = new_id()
            conn.execute(
                insert(user_favorites).values(
                    id=fid,
                    user_id=user.user_id,
                    location_id=location_id,
                    created_at=utcnow_iso(),
                )
            )


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite(
    location_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Remove a location from the current user's favorites."""
    with get_conn() as conn:
        with conn.begin():
            conn.execute(
                delete(user_favorites).where(
                    user_favorites.c.user_id == user.user_id,
                    user_favorites.c.location_id == location_id,
                )
            )
