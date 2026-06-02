import pymysql
import pymysql.cursors
import os
import json
from cryptography.fernet import Fernet

# Encryption key path
KEY_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'prism.key')

def get_or_create_key() -> bytes:
    key_path = os.path.abspath(KEY_PATH)
    if os.path.exists(key_path):
        with open(key_path, 'rb') as f:
            return f.read()
    key = Fernet.generate_key()
    os.makedirs(os.path.dirname(key_path), exist_ok=True)
    with open(key_path, 'wb') as f:
        f.write(key)
    return key

def encrypt_password(password: str) -> str:
    key = get_or_create_key()
    cipher = Fernet(key)
    return cipher.encrypt(password.encode()).decode()

def decrypt_password(encrypted: str) -> str:
    key = get_or_create_key()
    cipher = Fernet(key)
    return cipher.decrypt(encrypted.encode()).decode()

def get_connection(host: str, port: int, database: str, 
                   username: str, password: str) -> pymysql.connections.Connection:
    return pymysql.connect(
        host=host,
        port=port,
        database=database,
        user=username,
        password=password,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
        read_timeout=30,
        write_timeout=30,
        ssl=False,
        auth_plugin_map={'caching_sha2_password': 'caching_sha2_password'}
    )

def test_connection(host: str, port: int, database: str,
                    username: str, password: str) -> dict:
    try:
        conn = get_connection(host, port, database, username, password)
        cursor = conn.cursor()
        cursor.execute("SELECT VERSION() as version")
        result = cursor.fetchone()
        conn.close()
        return {
            "success": True,
            "message": f"Connected successfully",
            "version": result.get('version', 'Unknown')
        }
    except pymysql.err.OperationalError as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}
    except Exception as e:
        return {"success": False, "message": f"Error: {str(e)}"}

def get_schema(host: str, port: int, database: str,
               username: str, password: str) -> list:
    conn = get_connection(host, port, database, username, password)
    try:
        cursor = conn.cursor()
        # Get all tables
        cursor.execute("""
            SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = %s
            AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        """, (database,))
        tables = cursor.fetchall()

        result = []
        for table in tables:
            table_name = table['TABLE_NAME']
            # Get columns for each table
            cursor.execute("""
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
            """, (database, table_name))
            columns = cursor.fetchall()

            result.append({
                "table_name": table_name,
                "row_count": table.get('TABLE_ROWS', 0),
                "comment": table.get('TABLE_COMMENT', ''),
                "columns": [{
                    "name": col['COLUMN_NAME'],
                    "type": col['DATA_TYPE'],
                    "nullable": col['IS_NULLABLE'] == 'YES',
                    "key": col['COLUMN_KEY']
                } for col in columns]
            })
        return result
    finally:
        conn.close()

def execute_query(host: str, port: int, database: str,
                  username: str, password: str, sql: str) -> dict:
    conn = get_connection(host, port, database, username, password)
    try:
        cursor = conn.cursor()
        # Enforce read only
        cursor.execute("SET SESSION TRANSACTION READ ONLY")
        cursor.execute(sql)
        rows = cursor.fetchmany(10000)  # Max 10k rows
        if not rows:
            return {"columns": [], "rows": [], "row_count": 0}
        columns = [{"name": k, "type": "text"} for k in rows[0].keys()]
        return {
            "columns": columns,
            "rows": [dict(r) for r in rows],
            "row_count": len(rows)
        }
    finally:
        conn.close()