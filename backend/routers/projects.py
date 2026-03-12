from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db

router = APIRouter()

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#6af0a0"

class SaveQueryRequest(BaseModel):
    name: str
    question: Optional[str] = ""
    sql_query: str
    table_name: str
    project_id: Optional[int] = None
    result_row_count: Optional[int] = 0
    chart_type: Optional[str] = None
    chart_config: Optional[str] = None

@router.get("/projects")
async def list_projects():
    init_db()
    conn = get_connection()
    try:
        projects = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        result = []
        for p in projects:
            p_dict = dict(p)
            # Count datasets and queries in this project
            p_dict['dataset_count'] = conn.execute(
                "SELECT COUNT(*) as c FROM datasets WHERE project_id=?", (p['id'],)
            ).fetchone()['c']
            p_dict['query_count'] = conn.execute(
                "SELECT COUNT(*) as c FROM saved_queries WHERE project_id=?", (p['id'],)
            ).fetchone()['c']
            result.append(p_dict)
        return {"projects": result}
    finally:
        conn.close()

@router.post("/projects")
async def create_project(req: ProjectCreate):
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute(
            "INSERT INTO projects (name, description, color) VALUES (?, ?, ?)",
            (req.name, req.description, req.color)
        )
        conn.commit()
        project = conn.execute("SELECT * FROM projects WHERE id=?", (cursor.lastrowid,)).fetchone()
        return dict(project)
    finally:
        conn.close()

@router.delete("/projects/{project_id}")
async def delete_project(project_id: int):
    init_db()
    conn = get_connection()
    try:
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        conn.execute("DELETE FROM saved_queries WHERE project_id=?", (project_id,))
        conn.commit()
        return {"message": "Project deleted."}
    finally:
        conn.close()

@router.get("/projects/{project_id}/queries")
async def get_project_queries(project_id: int):
    init_db()
    conn = get_connection()
    try:
        queries = conn.execute(
            "SELECT * FROM saved_queries WHERE project_id=? ORDER BY created_at DESC", (project_id,)
        ).fetchall()
        return {"queries": [dict(q) for q in queries]}
    finally:
        conn.close()

@router.post("/queries/save")
async def save_query(req: SaveQueryRequest):
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute("""
            INSERT INTO saved_queries (name, question, sql_query, table_name, project_id, result_row_count, chart_type, chart_config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (req.name, req.question, req.sql_query, req.table_name,
              req.project_id, req.result_row_count, req.chart_type, req.chart_config))
        conn.commit()
        query = conn.execute("SELECT * FROM saved_queries WHERE id=?", (cursor.lastrowid,)).fetchone()
        return dict(query)
    finally:
        conn.close()

@router.get("/queries/saved")
async def list_saved_queries():
    init_db()
    conn = get_connection()
    try:
        queries = conn.execute("SELECT * FROM saved_queries ORDER BY created_at DESC").fetchall()
        return {"queries": [dict(q) for q in queries]}
    finally:
        conn.close()

@router.delete("/queries/{query_id}")
async def delete_query(query_id: int):
    init_db()
    conn = get_connection()
    try:
        conn.execute("DELETE FROM saved_queries WHERE id=?", (query_id,))
        conn.commit()
        return {"message": "Query deleted."}
    finally:
        conn.close()
