#!/usr/bin/env python3
"""
Migration script to add profile_pic column to users table.
Run this script to update the database schema.
"""
import sqlite3
import os
import sys

# Get the database path (adjust if needed)
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')

def migrate():
    """Add profile_pic column to users table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if column already exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'profile_pic' in columns:
            print("[OK] Column 'profile_pic' already exists in users table.")
            return
        
        # Add the column
        print("Adding 'profile_pic' column to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN profile_pic TEXT")
        conn.commit()
        
        print("[OK] Successfully added 'profile_pic' column to users table.")
        
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Error adding column: {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
