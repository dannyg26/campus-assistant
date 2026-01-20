#!/usr/bin/env python3
"""Create event_requests and events tables. Run: python scripts/add_events_tables.py"""
import os
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='event_requests'")
        if cur.fetchone():
            print("[OK] event_requests table already exists.")
        else:
            conn.execute("""
                CREATE TABLE event_requests (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    location TEXT,
                    top_qualities TEXT,
                    description TEXT,
                    picture TEXT,
                    meeting_time TEXT,
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
            conn.execute("CREATE INDEX ix_event_requests_org_id ON event_requests(org_id)")
            conn.execute("CREATE INDEX ix_event_requests_requested_by ON event_requests(requested_by)")
            print("[OK] Created event_requests table.")

        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
        if cur.fetchone():
            print("[OK] events table already exists.")
        else:
            conn.execute("""
                CREATE TABLE events (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    location TEXT,
                    top_qualities TEXT,
                    description TEXT,
                    picture TEXT,
                    meeting_time TEXT,
                    created_by_user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    FOREIGN KEY (org_id) REFERENCES organizations(id),
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                )
            """)
            conn.execute("CREATE INDEX ix_events_org_id ON events(org_id)")
            conn.execute("CREATE INDEX ix_events_created_by_user_id ON events(created_by_user_id)")
            print("[OK] Created events table.")

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
