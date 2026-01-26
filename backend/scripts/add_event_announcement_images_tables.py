#!/usr/bin/env python3
import sqlite3, os, sys

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "app.db")

DDL = [
    """
    CREATE TABLE IF NOT EXISTS announcement_images (
      id TEXT PRIMARY KEY,
      announcement_id TEXT NOT NULL,
      url TEXT NOT NULL,
      caption TEXT,
      position TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (announcement_id) REFERENCES announcements(id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_announcement_images_announcement_id ON announcement_images(announcement_id);",

    """
    CREATE TABLE IF NOT EXISTS event_images (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      url TEXT NOT NULL,
      caption TEXT,
      position TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_event_images_event_id ON event_images(event_id);",

    """
    CREATE TABLE IF NOT EXISTS announcement_request_images (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      url TEXT NOT NULL,
      caption TEXT,
      position TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES announcement_requests(id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_announcement_request_images_request_id ON announcement_request_images(request_id);",

    """
    CREATE TABLE IF NOT EXISTS event_request_images (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      url TEXT NOT NULL,
      caption TEXT,
      position TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES event_requests(id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_event_request_images_request_id ON event_request_images(request_id);",
]

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        for stmt in DDL:
            cur.execute(stmt)
        conn.commit()
        print("[OK] Created event/announcement image tables.")
    except Exception as e:
        conn.rollback()
        print("[ERROR]", e)
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
