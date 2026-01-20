#!/usr/bin/env python3
"""
Migration script to add image column to announcements table.
Run: python scripts/add_announcement_image_column.py
"""
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA table_info(announcements)")
        columns = [c[1] for c in cursor.fetchall()]
        if 'image' in columns:
            print("[OK] Column 'image' already exists in announcements table.")
            return
        print("Adding 'image' column to announcements table...")
        cursor.execute("ALTER TABLE announcements ADD COLUMN image TEXT")
        conn.commit()
        print("[OK] Successfully added 'image' column to announcements table.")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
