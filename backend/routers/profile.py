from fastapi import APIRouter, HTTPException
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.profiler import profile_dataframe
import pandas as pd

router = APIRouter()

@router.get("/profile/{table_name}")
async def get_profile(table_name: str):
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute(f"PRAGMA table_info({table_name})")
        if not cursor.fetchall():
            raise HTTPException(status_code=404, detail="Table not found.")
        df = pd.read_sql(f"SELECT * FROM {table_name}", conn)
        return profile_dataframe(df, table_name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/schema/{table_name}")
async def get_schema(table_name: str):
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute(f"PRAGMA table_info({table_name})")
        cols = cursor.fetchall()
        if not cols:
            raise HTTPException(status_code=404, detail="Table not found.")
        cursor2 = conn.execute(f"SELECT COUNT(*) as cnt FROM {table_name}")
        row_count = cursor2.fetchone()['cnt']
        columns = [{"name": c['name'], "type": c['type'] or 'text'} for c in cols]
        return {"table_name": table_name, "columns": columns, "row_count": row_count}
    finally:
        conn.close()

@router.get("/datasets")
async def list_datasets():
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC")
        return {"datasets": [dict(r) for r in cursor.fetchall()]}
    finally:
        conn.close()

@router.delete("/datasets/{table_name}")
async def delete_dataset(table_name: str):
    init_db()
    conn = get_connection()
    try:
        conn.execute(f"DROP TABLE IF EXISTS {table_name}")
        conn.execute("DELETE FROM datasets WHERE table_name=?", (table_name,))
        conn.commit()
        return {"message": f"Dataset {table_name} deleted."}
    finally:
        conn.close()
