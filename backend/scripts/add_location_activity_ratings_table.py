#!/usr/bin/env python3
"""
Migration script to create location_activity_ratings table.
Run from backend/: python scripts/add_location_activity_ratings_table.py
"""
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "app.db")


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS location_activity_ratings (
                id TEXT PRIMARY KEY,
                location_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                level TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (location_id) REFERENCES locations(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_location_activity_ratings_location_id ON location_activity_ratings(location_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_location_activity_ratings_user_id ON location_activity_ratings(user_id)"
        )
        conn.commit()
        print("[OK] location_activity_ratings table ready.")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
