#!/usr/bin/env python3
import os
import sqlite3
from urllib.parse import urlparse

def resolve_db_path() -> str:
    db_url = os.getenv("DATABASE_URL", "sqlite:///./app.db")
    if not db_url.startswith("sqlite"):
        raise RuntimeError(f"This migration is for sqlite only. DATABASE_URL={db_url}")

    # sqlite:///./app.db or sqlite:////absolute/path/app.db
    path = urlparse(db_url).path
    if path.startswith("/") and os.name == "nt":
        # On Windows urlparse gives /C:/... sometimes
        path = path.lstrip("/")
    if not path:
        raise RuntimeError(f"Could not resolve sqlite path from DATABASE_URL={db_url}")
    return os.path.abspath(path)

def has_column(cur, table, column):
    rows = cur.execute(f"PRAGMA table_info({table});").fetchall()
    return any(r[1] == column for r in rows)

def table_exists(cur, table):
    r = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
        (table,),
    ).fetchone()
    return r is not None

def migrate():
    db_path = resolve_db_path()
    print("[INFO] Using DB:", db_path)

    if not os.path.exists(db_path):
        raise RuntimeError(f"DB file does not exist: {db_path}")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    try:
        # Fail fast if you're on the wrong DB
        if not table_exists(cur, "announcements"):
            tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            raise RuntimeError(f"'announcements' table not found. Tables in this DB: {tables}")

        # announcements.pictures
        if not has_column(cur, "announcements", "pictures"):
            cur.execute("ALTER TABLE announcements ADD COLUMN pictures TEXT")

        # announcement_requests.pictures
        if table_exists(cur, "announcement_requests") and not has_column(cur, "announcement_requests", "pictures"):
            cur.execute("ALTER TABLE announcement_requests ADD COLUMN pictures TEXT")

        conn.commit()
        print("[OK] Added pictures JSON columns.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
