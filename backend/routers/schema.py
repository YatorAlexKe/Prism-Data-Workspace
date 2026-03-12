from fastapi import APIRouter, HTTPException
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.llm import detect_joins

router = APIRouter()

class JoinDetectRequest:
    pass

@router.get("/schema/tables")
async def list_tables():
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC")
        return {"tables": [dict(r) for r in cursor.fetchall()]}
    finally:
        conn.close()

@router.post("/schema/detect-joins")
async def detect_join_opportunities(payload: dict):
    init_db()
    table_names = payload.get('table_names', [])
    provider = payload.get('provider', 'ollama')
    api_key = payload.get('api_key')
    model = payload.get('model')
    
    conn = get_connection()
    try:
        schemas = []
        for tname in table_names:
            cursor = conn.execute(f"PRAGMA table_info({tname})")
            cols = cursor.fetchall()
            if cols:
                schemas.append({
                    "table_name": tname,
                    "columns": [{"name": c['name'], "type": c['type'] or 'text'} for c in cols]
                })
        
        if len(schemas) < 2:
            return {"joins": [], "message": "Need at least 2 tables to detect joins."}
        
        # Heuristic join detection (fast, no LLM needed)
        joins = heuristic_join_detect(schemas)
        
        # Also try LLM if available
        try:
            llm_joins = detect_joins(schemas, provider, api_key, model)
            # Merge, deduplicate
            existing = {(j['table1'], j['col1'], j['table2'], j['col2']) for j in joins}
            for j in llm_joins.get('joins', []):
                key = (j.get('table1'), j.get('col1'), j.get('table2'), j.get('col2'))
                if key not in existing:
                    joins.append(j)
        except Exception:
            pass
        
        return {"joins": joins, "schemas": schemas}
    finally:
        conn.close()

def heuristic_join_detect(schemas: list) -> list:
    joins = []
    for i, s1 in enumerate(schemas):
        for s2 in schemas[i+1:]:
            cols1 = {c['name'].lower() for c in s1['columns']}
            cols2 = {c['name'].lower() for c in s2['columns']}
            common = cols1 & cols2
            for col in common:
                c1 = next(c for c in s1['columns'] if c['name'].lower() == col)
                c2 = next(c for c in s2['columns'] if c['name'].lower() == col)
                joins.append({
                    "table1": s1['table_name'], "col1": c1['name'],
                    "table2": s2['table_name'], "col2": c2['name'],
                    "confidence": "high", "source": "heuristic"
                })
    return joins
