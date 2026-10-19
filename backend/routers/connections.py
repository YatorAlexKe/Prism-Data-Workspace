from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection as get_prism_db, init_db
from utils.mysql_connector import (
    test_connection, get_schema, get_connection as get_mysql_conn,
    encrypt_password, decrypt_password
)
from utils.nl2sql import answer, mysql_runner, NLQueryError

DISPLAY_ROWS = 1000  # same cap as routers/query.py; export still returns everything

router = APIRouter()

class ConnectionCreate(BaseModel):
    name: str
    host: str
    port: Optional[int] = 3306
    database: str
    username: str
    password: str

class ConnectionTest(BaseModel):
    host: str
    port: Optional[int] = 3306
    database: str
    username: str
    password: str

class ConnectionQuery(BaseModel):
    connection_id: int
    table_name: str
    question: str
    provider: Optional[str] = "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None

class DirectConnectionSQL(BaseModel):
    connection_id: int
    sql: str

def init_connections_table():
    init_db()
    conn = get_prism_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS db_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            db_type TEXT DEFAULT 'mysql',
            host TEXT NOT NULL,
            port INTEGER DEFAULT 3306,
            database_name TEXT NOT NULL,
            username TEXT NOT NULL,
            encrypted_password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def get_conn_details(connection_id: int) -> dict:
    conn = get_prism_db()
    try:
        cursor = conn.execute(
            "SELECT * FROM db_connections WHERE id=?", (connection_id,)
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Connection not found.")
        return dict(row)
    finally:
        conn.close()

@router.post("/connections/test")
async def test_db_connection(req: ConnectionTest):
    result = test_connection(
        req.host, req.port or 3306,
        req.database, req.username, req.password
    )
    if not result['success']:
        raise HTTPException(status_code=400, detail=result['message'])
    return result

@router.post("/connections")
async def create_connection(req: ConnectionCreate):
    init_connections_table()

    # Test first
    test = test_connection(
        req.host, req.port or 3306,
        req.database, req.username, req.password
    )
    if not test['success']:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot save — connection failed: {test['message']}"
        )

    # Encrypt password before storing
    encrypted = encrypt_password(req.password)

    conn = get_prism_db()
    try:
        cursor = conn.execute("""
            INSERT INTO db_connections
            (name, host, port, database_name, username, encrypted_password)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (req.name, req.host, req.port or 3306,
              req.database, req.username, encrypted))
        conn.commit()
        conn_id = cursor.lastrowid
        return {
            "id": conn_id,
            "name": req.name,
            "host": req.host,
            "database": req.database,
            "message": "Connection saved successfully."
        }
    finally:
        conn.close()

@router.get("/connections")
async def list_connections():
    init_connections_table()
    conn = get_prism_db()
    try:
        cursor = conn.execute("""
            SELECT id, name, db_type, host, port, database_name, username, created_at
            FROM db_connections ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()
        return {"connections": [dict(r) for r in rows]}
    finally:
        conn.close()

@router.delete("/connections/{connection_id}")
async def delete_connection(connection_id: int):
    init_connections_table()
    conn = get_prism_db()
    try:
        conn.execute("DELETE FROM db_connections WHERE id=?", (connection_id,))
        conn.commit()
        return {"message": "Connection removed."}
    finally:
        conn.close()

@router.get("/connections/{connection_id}/schema")
async def get_connection_schema(connection_id: int):
    details = get_conn_details(connection_id)
    password = decrypt_password(details['encrypted_password'])
    try:
        schema = get_schema(
            details['host'], details['port'],
            details['database_name'], details['username'], password
        )
        return {
            "connection_id": connection_id,
            "name": details['name'],
            "database": details['database_name'],
            "tables": schema
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema error: {str(e)}")

@router.post("/connections/query")
async def query_connection(req: ConnectionQuery):
    details = get_conn_details(req.connection_id)
    password = decrypt_password(details['encrypted_password'])

    # Get schema for the specific table
    try:
        schema = get_schema(
            details['host'], details['port'],
            details['database_name'], details['username'], password
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema error: {str(e)}")

    # Find the requested table
    table = next((t for t in schema if t['table_name'] == req.table_name), None)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found.")

    # One read-only connection for describing the table, generating and running the query.
    try:
        mconn = get_mysql_conn(details['host'], details['port'],
                               details['database_name'], details['username'], password)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query error: {str(e)}")
    try:
        run = mysql_runner(mconn)
        out = answer(req.question, [{"table_name": req.table_name, "columns": table['columns']}],
                     run, 'mysql', req.provider or "ollama", req.api_key, req.model,
                     cache_key=f"mysql:{req.connection_id}", max_rows=DISPLAY_ROWS)
        total = len(out["rows"])
        if out["truncated"]:
            try:
                total = run(f"SELECT COUNT(*) FROM ({out['sql']}) AS q")[1][0][0]
            except Exception:
                total = None
    except NLQueryError as e:
        raise HTTPException(status_code=503 if e.stage == 'llm' else 400, detail=e.message)
    finally:
        mconn.close()

    rows = [dict(zip(out["columns"], r)) for r in out["rows"]]
    result = {
        "columns": [{"name": n, "type": "text"} for n in out["columns"]] if rows else [],
        "rows": rows,
        "row_count": len(rows),
        "truncated": out["truncated"],
        "total_count": total,
    }
    return {
        "question": req.question,
        "sql": out["sql"],
        "interpretation": out["interpretation"],
        "repaired": bool(out["attempts"]),
        "schema": out["schema"],
        "result": result,
        "source": "mysql",
        "connection": details['name']
    }