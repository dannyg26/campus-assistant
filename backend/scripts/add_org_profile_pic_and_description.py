#!/usr/bin/env python3
"""Add org_profile_pic to organizations; description to location_requests and locations. Run: python scripts/add_org_profile_pic_and_description.py"""
import os
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    try:
        # organizations: org_profile_pic
        cur = conn.execute("PRAGMA table_info(organizations)")
        org_cols = [c[1] for c in cur.fetchall()]
        if 'org_profile_pic' not in org_cols:
            conn.execute("ALTER TABLE organizations ADD COLUMN org_profile_pic TEXT")
            print("[OK] Added org_profile_pic to organizations.")
        else:
            print("[OK] org_profile_pic already exists in organizations.")

        # location_requests: description
        cur = conn.execute("PRAGMA table_info(location_requests)")
        lr_cols = [c[1] for c in cur.fetchall()]
        if 'description' not in lr_cols:
            conn.execute("ALTER TABLE location_requests ADD COLUMN description TEXT")
            print("[OK] Added description to location_requests.")
        else:
            print("[OK] description already exists in location_requests.")

        # locations: description
        cur = conn.execute("PRAGMA table_info(locations)")
        loc_cols = [c[1] for c in cur.fetchall()]
        if 'description' not in loc_cols:
            conn.execute("ALTER TABLE locations ADD COLUMN description TEXT")
            print("[OK] Added description to locations.")
        else:
            print("[OK] description already exists in locations.")

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
