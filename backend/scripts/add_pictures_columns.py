#!/usr/bin/env python3
import sqlite3, os, sys

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "app.db")

TARGETS = [
    ("announcements", "pictures"),
    ("announcement_requests", "pictures"),
    ("events", "pictures"),
    ("event_requests", "pictures"),
]

def col_exists(cur, table, col):
    cur.execute(f"PRAGMA table_info({table})")
    return col in [r[1] for r in cur.fetchall()]

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        for table, col in TARGETS:
            if col_exists(cur, table, col):
                print(f"[OK] {table}.{col} already exists")
                continue
            print(f"Adding {table}.{col} ...")
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
        conn.commit()
        print("[OK] Done.")
    except Exception as e:
        conn.rollback()
        print("[ERROR]", e)
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
