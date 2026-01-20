# scripts/purge_users.py
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select

from app.db import get_conn, refresh_tokens, users

def main() -> None:
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        # Find users eligible for purge
        purge_rows = conn.execute(
            select(users.c.id).where(
                users.c.is_active == False,  # noqa: E712
                users.c.purge_after.is_not(None),
                users.c.purge_after <= now,
            )
        ).mappings().all()

        user_ids = [r["id"] for r in purge_rows]
        if not user_ids:
            print("No users to purge.")
            return

        # Revoke/delete refresh tokens first
        conn.execute(delete(refresh_tokens).where(refresh_tokens.c.user_id.in_(user_ids)))

        # NOTE: when you add reviews table, you will also delete reviews by these users here.

        # Finally delete user rows
        conn.execute(delete(users).where(users.c.id.in_(user_ids)))
        conn.commit()

        print(f"Purged {len(user_ids)} user(s): {user_ids}")

if __name__ == "__main__":
    main()
