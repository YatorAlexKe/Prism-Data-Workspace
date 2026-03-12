import sqlite3
import os
import json

# SQLite for dataset storage (works out of box, no setup needed)
# PostgreSQL connection string can be configured via .env for production
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "database", "prism.db")

def get_connection():
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(os.path.abspath(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS datasets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            table_name TEXT UNIQUE NOT NULL,
            original_filename TEXT,
            source_type TEXT DEFAULT 'file',
            source_url TEXT,
            row_count INTEGER,
            col_count INTEGER,
            file_format TEXT,
            project_id INTEGER,
            data_quality_score REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#6af0a0',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS saved_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            question TEXT,
            sql_query TEXT NOT NULL,
            table_name TEXT,
            project_id INTEGER,
            result_row_count INTEGER,
            chart_type TEXT,
            chart_config TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS query_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT,
            question TEXT,
            sql_query TEXT,
            row_count INTEGER,
            execution_ms INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()
