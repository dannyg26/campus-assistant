# app/routers/reviews.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_conn, locations, reviews, new_id, utcnow_iso
from app.deps import CurrentUser, get_current_user, require_admin
from sqlalchemy import func, select, update

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewBase(BaseModel):
    rating: int = Field(ge=1, le=5, description="Rating from 1 to 5")
    review_text: Optional[str] = None


class ReviewResponse(BaseModel):
    id: str
    location_id: str
    location_name: str
    user_id: str
    user_name: str
    user_email: str
    user_role: Optional[str] = None
    user_profile_pic: Optional[str] = None
    rating: int
    review_text: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class CreateReviewRequest(ReviewBase):
    pass


def _update_location_rating_stats(conn, location_id: str) -> None:
    """Update the location's average rating and review count."""
    from sqlalchemy import Float, cast

    # Calculate average rating and count
    # Convert string rating to float for calculation
    stats = conn.execute(
        select(
            func.avg(cast(reviews.c.rating, Float)).label("avg_rating"),
            func.count(reviews.c.id).label("count"),
        ).where(
            reviews.c.location_id == location_id,
            reviews.c.deleted_at.is_(None),
        )
    ).mappings().first()

    avg_rating = float(stats["avg_rating"] or 0.0)
    review_count = int(stats["count"] or 0)

    # Update location
    conn.execute(
        update(locations)
        .where(locations.c.id == location_id)
        .values(
            rating=str(round(avg_rating, 1)),
            reviews_count=str(review_count),
        )
    )


@router.post("/locations/{location_id}", response_model=ReviewResponse, status_code=status.HTTP_201_CREATED)
def create_review(
    location_id: str,
    req: CreateReviewRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ReviewResponse:
    """
    Create a review for a location.
    Students can create one review per location.
    """
    from sqlalchemy import insert

    with get_conn() as conn, conn.begin():
        # Verify location exists and belongs to org
        location_row = conn.execute(
            select(locations.c.id, locations.c.name).where(
                locations.c.id == location_id,
                locations.c.org_id == user.org_id,
                locations.c.is_active == True,  # noqa: E712
            )
        ).mappings().first()

        if not location_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )

        # Check if user already has a review for this location
        existing_review = conn.execute(
            select(reviews.c.id).where(
                reviews.c.location_id == location_id,
                reviews.c.user_id == user.user_id,
                reviews.c.deleted_at.is_(None),
            )
        ).mappings().first()

        if existing_review:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You have already reviewed this location. Use PUT to update your review.",
            )

        # Create review
        review_id = new_id()
        now = utcnow_iso()
        conn.execute(
            insert(reviews).values(
                id=review_id,
                location_id=location_id,
                user_id=user.user_id,
                org_id=user.org_id,
                rating=str(req.rating),
                review_text=req.review_text.strip() if req.review_text else None,
                created_at=now,
                updated_at=None,
                deleted_at=None,
            )
        )

        # Update location rating stats
        _update_location_rating_stats(conn, location_id)

    return ReviewResponse(
        id=review_id,
        location_id=location_id,
        location_name=str(location_row["name"]),
        user_id=user.user_id,
        user_name=user.name,
        user_email=user.email,
        user_role=user.role,
        user_profile_pic=user.profile_pic,
        rating=req.rating,
        review_text=req.review_text,
        created_at=now,
        updated_at=None,
    )


@router.get("/locations/{location_id}", response_model=list[ReviewResponse])
def list_reviews(
    location_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[ReviewResponse]:
    """List all reviews for a location."""
    with get_conn() as conn:
        # Verify location exists
        location_row = conn.execute(
            select(locations.c.id, locations.c.name).where(
                locations.c.id == location_id,
                locations.c.org_id == user.org_id,
            )
        ).mappings().first()

        if not location_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )

        # Get reviews with user info
        rows = conn.execute(
            select(
                reviews.c.id,
                reviews.c.location_id,
                reviews.c.user_id,
                reviews.c.rating,
                reviews.c.review_text,
                reviews.c.created_at,
                reviews.c.updated_at,
            ).where(
                reviews.c.location_id == location_id,
                reviews.c.deleted_at.is_(None),
            ).order_by(reviews.c.created_at.desc())
        ).mappings().all()

        # Fetch user info for each review
        from app.db import users
        result = []
        for row in rows:
            user_row = conn.execute(
                select(users.c.name, users.c.email, users.c.role, users.c.profile_pic).where(users.c.id == row["user_id"])
            ).mappings().first()

            result.append(
                ReviewResponse(
                    id=str(row["id"]),
                    location_id=str(row["location_id"]),
                    location_name=str(location_row["name"]),
                    user_id=str(row["user_id"]),
                    user_name=str(user_row["name"]) if user_row else "Unknown",
                    user_email=str(user_row["email"]) if user_row else "Unknown",
                    user_role=str(user_row["role"]) if user_row else None,
                    user_profile_pic=str(user_row["profile_pic"]) if user_row and user_row["profile_pic"] else None,
                    rating=int(row["rating"]),
                    review_text=str(row["review_text"]) if row["review_text"] else None,
                    created_at=str(row["created_at"]),
                    updated_at=str(row["updated_at"]) if row["updated_at"] else None,
                )
            )

    return result


@router.put("/{review_id}", response_model=ReviewResponse)
def update_review(
    review_id: str,
    req: ReviewBase,
    user: CurrentUser = Depends(get_current_user),
) -> ReviewResponse:
    """
    Update your own review.
    Students can update their own reviews, admins can update any review.
    """
    from sqlalchemy import select

    with get_conn() as conn, conn.begin():
        # Get review
        review_row = conn.execute(
            select(
                reviews.c.id,
                reviews.c.location_id,
                reviews.c.user_id,
                reviews.c.org_id,
            ).where(
                reviews.c.id == review_id,
                reviews.c.deleted_at.is_(None),
            )
        ).mappings().first()

        if not review_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Review not found",
            )

        # Verify org match
        if str(review_row["org_id"]) != user.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot access reviews from other organizations",
            )

        # Check permission: must be own review or admin
        if str(review_row["user_id"]) != user.user_id and user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only update your own reviews",
            )

        # Get location name
        location_row = conn.execute(
            select(locations.c.name).where(locations.c.id == review_row["location_id"])
        ).mappings().first()

        # Update review
        now = utcnow_iso()
        conn.execute(
            update(reviews)
            .where(reviews.c.id == review_id)
            .values(
                rating=str(req.rating),
                review_text=req.review_text.strip() if req.review_text else None,
                updated_at=now,
            )
        )

        # Update location rating stats
        _update_location_rating_stats(conn, str(review_row["location_id"]))

        # Fetch updated review
        updated_row = conn.execute(
            select(reviews).where(reviews.c.id == review_id)
        ).mappings().first()

        from app.db import users
        user_row = conn.execute(
            select(users.c.name, users.c.email, users.c.role, users.c.profile_pic).where(users.c.id == updated_row["user_id"])
        ).mappings().first()

        return ReviewResponse(
            id=str(updated_row["id"]),
            location_id=str(updated_row["location_id"]),
            location_name=str(location_row["name"]) if location_row else "Unknown",
            user_id=str(updated_row["user_id"]),
            user_name=str(user_row["name"]) if user_row else "Unknown",
            user_email=str(user_row["email"]) if user_row else "Unknown",
            user_role=str(user_row["role"]) if user_row else None,
            user_profile_pic=str(user_row["profile_pic"]) if user_row and user_row["profile_pic"] else None,
            rating=int(updated_row["rating"]),
            review_text=str(updated_row["review_text"]) if updated_row["review_text"] else None,
            created_at=str(updated_row["created_at"]),
            updated_at=str(updated_row["updated_at"]) if updated_row["updated_at"] else None,
        )


@router.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(
    review_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> None:
    """
    Delete a review.
    Admin-only: Only administrators can delete reviews.
    """
    from sqlalchemy import select

    with get_conn() as conn, conn.begin():
        # Get review
        review_row = conn.execute(
            select(
                reviews.c.id,
                reviews.c.location_id,
                reviews.c.user_id,
                reviews.c.org_id,
            ).where(
                reviews.c.id == review_id,
                reviews.c.deleted_at.is_(None),
            )
        ).mappings().first()

        if not review_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Review not found",
            )

        # Verify org match
        if str(review_row["org_id"]) != admin.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot access reviews from other organizations",
            )

        # Admin-only: permission already checked by require_admin

        # Soft delete review
        conn.execute(
            update(reviews)
            .where(reviews.c.id == review_id)
            .values(deleted_at=utcnow_iso())
        )

        # Update location rating stats
        _update_location_rating_stats(conn, str(review_row["location_id"]))
