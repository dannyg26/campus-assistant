#!/usr/bin/env python3
"""Create user_favorites table if it does not exist. Run: python scripts/add_user_favorites_table.py"""
import os
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_favorites (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                location_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (location_id) REFERENCES locations (id),
                UNIQUE (user_id, location_id)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_favorites_user_id ON user_favorites (user_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_favorites_location_id ON user_favorites (location_id)"
        )
        conn.commit()
        print("[OK] user_favorites table ready.")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
