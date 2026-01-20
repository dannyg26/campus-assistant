#!/usr/bin/env python3
"""Create announcement_requests table. Run: python scripts/add_announcement_requests_table.py"""
import os
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='announcement_requests'"
        )
        if cur.fetchone():
            print("[OK] announcement_requests table already exists.")
        else:
            conn.execute("""
                CREATE TABLE announcement_requests (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    image TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    reviewed_by TEXT,
                    reviewed_at TEXT,
                    admin_notes TEXT,
                    FOREIGN KEY (org_id) REFERENCES organizations(id),
                    FOREIGN KEY (requested_by) REFERENCES users(id),
                    FOREIGN KEY (reviewed_by) REFERENCES users(id)
                )
            """)
            conn.execute("CREATE INDEX ix_announcement_requests_org_id ON announcement_requests(org_id)")
            conn.execute("CREATE INDEX ix_announcement_requests_requested_by ON announcement_requests(requested_by)")
            print("[OK] Created announcement_requests table.")
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
