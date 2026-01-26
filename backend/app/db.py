from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Index,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    select,
)
from sqlalchemy.engine import Connection, Engine

# ---------------------------------------------------------------------
# Environment / Engine
# ---------------------------------------------------------------------
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

engine: Engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

metadata = MetaData()

# ---------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------
def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

# ---------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------

# ---- Organizations (Universities)
organizations = Table(
    "organizations",
    metadata,
    Column("id", String, primary_key=True),
    Column("name", String(200), nullable=False),
    # Kept for display / admin editing; not used for lookups anymore
    Column("allowed_email_domains", Text, nullable=True),  # JSON list (optional redundancy)
    Column("org_profile_pic", Text, nullable=True),  # optional org avatar/logo
    Column("is_public", Boolean, nullable=False, default=True),
    Column("created_at", String, nullable=False),
)

# ---- Organization Domains (FAST lookup for Option A)
org_domains = Table(
    "org_domains",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("domain", String(255), nullable=False, index=True),
    Column("created_at", String, nullable=False),
)

# One domain → one org (required for Option A)
Index("uq_org_domains_domain", org_domains.c.domain, unique=True)

# ---- Users
users = Table(
    "users",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("email", String(320), nullable=False),
    Column("name", String(200), nullable=False),  # display name
    Column("profile_pic", Text, nullable=True),  # Profile picture URL
    Column("password_hash", String(500), nullable=False),
    Column("role", String(20), nullable=False),  # 'admin' | 'student'
    Column("is_active", Boolean, nullable=False, default=True),

    # soft-delete + retention
    Column("deleted_at", String, nullable=True),
    Column("purge_after", String, nullable=True),

    Column("created_at", String, nullable=False),
)

# Email uniqueness scoped to org
Index("uq_users_org_email", users.c.org_id, users.c.email, unique=True)

# ---- Refresh Tokens
refresh_tokens = Table(
    "refresh_tokens",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("user_id", String, ForeignKey("users.id"), nullable=False, index=True),

    # Store HASH only, never raw token
    Column("token_hash", String(128), nullable=False, index=True),

    Column("expires_at", String, nullable=False),
    Column("revoked_at", String, nullable=True),
    Column("created_at", String, nullable=False),
)

Index("uq_refresh_token_hash", refresh_tokens.c.token_hash, unique=True)

# ---- Locations (Campus spots)
locations = Table(
    "locations",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("name", String(200), nullable=False),
    Column("address", Text, nullable=False),  # Complete address
    Column("pictures", Text, nullable=True),  # JSON array of picture URLs
    Column("rating", String(10), nullable=False, default="0.0"),  # Average rating as string
    Column("reviews_count", String(20), nullable=False, default="0"),  # Count as string for consistency
    Column("description", Text, nullable=True),
    Column("most_known_for", Text, nullable=True),
    Column("level_of_business", String(50), nullable=True),  # e.g., "high", "moderate", "low"
    Column("created_by", String, ForeignKey("users.id"), nullable=False),
    Column("is_active", Boolean, nullable=False, default=True),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=True),
)

# ---- Location Requests (Student requests for new locations)
location_requests = Table(
    "location_requests",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("name", String(200), nullable=False),
    Column("address", Text, nullable=False),
    Column("pictures", Text, nullable=True),  # JSON array of picture URLs
    Column("description", Text, nullable=True),
    Column("most_known_for", Text, nullable=True),
    Column("level_of_business", String(50), nullable=True),
    Column("requested_by", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("status", String(20), nullable=False, default="pending"),  # 'pending', 'approved', 'denied'
    Column("admin_notes", Text, nullable=True),  # Denial reason or admin notes
    Column("reviewed_by", String, ForeignKey("users.id"), nullable=True),
    Column("reviewed_at", String, nullable=True),
    Column("created_at", String, nullable=False),
)

# ---- Reviews
reviews = Table(
    "reviews",
    metadata,
    Column("id", String, primary_key=True),
    Column("location_id", String, ForeignKey("locations.id"), nullable=False, index=True),
    Column("user_id", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("rating", String(10), nullable=False),  # 1-5 rating as string
    Column("review_text", Text, nullable=True),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=True),
    Column("deleted_at", String, nullable=True),  # Soft delete
)

# One review per user per location (but allow updates)
Index("uq_reviews_location_user", reviews.c.location_id, reviews.c.user_id, unique=True)

# ---- Location Activity Ratings (user-reported level over time; 2h cooldown per user per location)
location_activity_ratings = Table(
    "location_activity_ratings",
    metadata,
    Column("id", String, primary_key=True),
    Column("location_id", String, ForeignKey("locations.id"), nullable=False, index=True),
    Column("user_id", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("level", String(20), nullable=False),  # 'low' | 'moderate' | 'high'
    Column("created_at", String, nullable=False),
)

# ---- User Favorites (user_id + location_id, org-scoped via location)
user_favorites = Table(
    "user_favorites",
    metadata,
    Column("id", String, primary_key=True),
    Column("user_id", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("location_id", String, ForeignKey("locations.id"), nullable=False, index=True),
    Column("created_at", String, nullable=False),
)
Index("uq_user_favorites_user_location", user_favorites.c.user_id, user_favorites.c.location_id, unique=True)

# ---- Announcements (admin-only create; students read published only)
announcements = Table(
    "announcements",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("title", String(500), nullable=False),
    Column("body", Text, nullable=False),

    # NEW: JSON array of {url, caption?}
    Column("pictures", Text, nullable=True),

    # Keep legacy single-image field for backward compatibility
    Column("image", Text, nullable=True),

    Column("status", String(20), nullable=False, default="draft"),  # 'draft' | 'published'
    Column("created_by_user_id", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=True),
    Column("published_at", String, nullable=True),
)


# ---- Announcement Requests (students request; admin approves/denies)
announcement_requests = Table(
    "announcement_requests",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("requested_by", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("title", String(500), nullable=False),
    Column("body", Text, nullable=False),

    # NEW: JSON array of {url, caption?}
    Column("pictures", Text, nullable=True),

    # Keep legacy single-image field for backward compatibility
    Column("image", Text, nullable=True),

    Column("status", String(20), nullable=False, default="pending"),  # 'pending' | 'approved' | 'denied'
    Column("created_at", String, nullable=False),
    Column("reviewed_by", String, ForeignKey("users.id"), nullable=True),
    Column("reviewed_at", String, nullable=True),
    Column("admin_notes", Text, nullable=True),
)



# ---- Announcement Comments (students on published only; admin or owner can delete)
announcement_comments = Table(
    "announcement_comments",
    metadata,
    Column("id", String, primary_key=True),
    Column("announcement_id", String, ForeignKey("announcements.id"), nullable=False, index=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("user_id", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("body", Text, nullable=False),
    Column("created_at", String, nullable=False),
)

announcement_images = Table(
    "announcement_images",
    metadata,
    Column("id", String, primary_key=True),
    Column("announcement_id", String, ForeignKey("announcements.id"), nullable=False, index=True),
    Column("url", Text, nullable=False),
    Column("caption", Text, nullable=True),
    Column("position", String(10), nullable=True),  # store as string for consistency if you want
    Column("created_at", String, nullable=False),
)
Index("ix_annou2ww2ncement_images_announcement_id", announcement_images.c.announcement_id)

event_images = Table(
    "event_images",
    metadata,
    Column("id", String, primary_key=True),
    Column("event_id", String, ForeignKey("events.id"), nullable=False, index=True),
    Column("url", Text, nullable=False),
    Column("caption", Text, nullable=True),
    Column("position", String(10), nullable=True),
    Column("created_at", String, nullable=False),
)
Index("ix_event_images_event_id", event_images.c.event_id)


# ---- Event Requests (students request; admin approves/denies; similar to announcement_requests)
event_requests = Table(
    "event_requests",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("requested_by", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("event_name", String(500), nullable=False),
    Column("location", String(500), nullable=True),
    Column("top_qualities", Text, nullable=True),
    Column("description", Text, nullable=True),
    Column("picture", Text, nullable=True),
    Column("meeting_time", String(100), nullable=True),
    Column("status", String(20), nullable=False, default="pending"),
    Column("created_at", String, nullable=False),
    Column("reviewed_by", String, ForeignKey("users.id"), nullable=True),
    Column("reviewed_at", String, nullable=True),
    Column("admin_notes", Text, nullable=True),
)


event_request_images = Table(
    "event_request_images",
    metadata,
    Column("id", String, primary_key=True),
    Column("request_id", String, ForeignKey("event_requests.id"), nullable=False, index=True),
    Column("url", Text, nullable=False),
    Column("caption", Text, nullable=True),
    Column("position", String(10), nullable=True),
    Column("created_at", String, nullable=False),
)
Index("ix_event_request_images_request_id", event_request_images.c.request_id)


# ---- Events (approved/published; admin can also create directly)
events = Table(
    "events",
    metadata,
    Column("id", String, primary_key=True),
    Column("org_id", String, ForeignKey("organizations.id"), nullable=False, index=True),
    Column("event_name", String(500), nullable=False),
    Column("location", String(500), nullable=True),
    Column("top_qualities", Text, nullable=True),
    Column("description", Text, nullable=True),
    Column("picture", Text, nullable=True),
    Column("meeting_time", String(100), nullable=True),
    Column("created_by_user_id", String, ForeignKey("users.id"), nullable=False, index=True),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=True),
)

# ---------------------------------------------------------------------
# DB Init
# ---------------------------------------------------------------------
def init_db() -> None:
    metadata.create_all(engine)

def get_conn() -> Connection:
    return engine.connect()

# ---------------------------------------------------------------------
# Query Helpers
# ---------------------------------------------------------------------
def get_org_by_id(conn: Connection, org_id: str) -> Optional[dict[str, Any]]:
    row = conn.execute(
        select(organizations).where(organizations.c.id == org_id)
    ).mappings().first()
    return dict(row) if row else None

def list_public_orgs(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        select(organizations.c.id, organizations.c.name)
        .where(organizations.c.is_public == True)  # noqa: E712
        .order_by(organizations.c.name.asc())
    ).mappings().all()
    return [dict(r) for r in rows]

def resolve_org_id_by_domain(conn: Connection, domain: str) -> Optional[str]:
    """
    Option A core:
    Resolve university by email domain.
    """
    d = domain.strip().lower()
    row = conn.execute(
        select(org_domains.c.org_id).where(org_domains.c.domain == d)
    ).mappings().first()
    return str(row["org_id"]) if row else None

def parse_domains_json(domains_json: Optional[str]) -> Optional[list[str]]:
    """
    Helper for admin-facing domain lists (optional redundancy).
    """
    if not domains_json:
        return None
    try:
        data = json.loads(domains_json)
        if not isinstance(data, list):
            return None
        out: list[str] = []
        for d in data:
            if isinstance(d, str):
                dd = d.strip().lower()
                if dd:
                    out.append(dd)
        return out or None
    except Exception:
        return None
