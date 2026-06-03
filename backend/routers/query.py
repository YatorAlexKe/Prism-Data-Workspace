from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import time, sys, os, io
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.sql_validator import validate_sql, extract_sql_from_response
from utils.llm import build_schema_context, build_prompt, generate_sql, fix_sql, call_llm, build_chart_prompt
from utils.chart_advisor import heuristic_chart

router = APIRouter()

class QueryRequest(BaseModel):
    table_name: str
    question: str
    provider: Optional[str] = "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None

class DirectSQLRequest(BaseModel):
    table_name: str
    sql: str
    provider: Optional[str] = "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None

class FixSQLRequest(BaseModel):
    table_name: str
    broken_sql: str
    error_message: str
    provider: Optional[str] = "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None

class MultiTableQueryRequest(BaseModel):
    table_names: list
    question: str
    provider: Optional[str] = "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None

def detect_location_type(columns: list) -> dict:
    col_names = [c['name'].lower() if isinstance(c, dict) else c.lower() for c in columns]
    
    # Check for lat/lon coordinates
    has_lat = any(c in col_names for c in ['latitude', 'lat'])
    has_lon = any(c in col_names for c in ['longitude', 'lon', 'lng', 'long'])
    if has_lat and has_lon:
        lat_col = next(c for c in col_names if c in ['latitude', 'lat'])
        lon_col = next(c for c in col_names if c in ['longitude', 'lon', 'lng', 'long'])
        return {
            "type": "coordinates",
            "lat_col": lat_col,
            "lon_col": lon_col
        }
    
    # Check for country level
    country_cols = ['country', 'nation', 'country_name']
    for col in col_names:
        if col in country_cols or 'country' in col:
            return {
                "type": "country",
                "location_col": col_names[col_names.index(col)]
            }
    
    # Check for region/province/state level
    region_cols = ['province', 'state', 'region', 'district', 
                   'county', 'territory', 'area', 'zone', 'city', 'town']
    for col in col_names:
        if any(r in col for r in region_cols):
            return {
                "type": "region",
                "location_col": col_names[col_names.index(col)]
            }
    
    return {"type": None}

def get_table_schema(conn, table_name: str) -> list:
    cursor = conn.execute(f"PRAGMA table_info({table_name})")
    return [{"name": c['name'], "type": c['type'] or 'text'} for c in cursor.fetchall()]

def execute_query(conn, sql: str) -> dict:
    cursor = conn.execute(sql)
    rows = cursor.fetchall()
    if not rows:
        return {"columns": [], "rows": [], "row_count": 0}
    columns = [{"name": desc[0], "type": "text"} for desc in cursor.description]
    data = [{col['name']: (val if val is not None else "") for col, val in zip(columns, row)} for row in rows]
    return {"columns": columns, "rows": data, "row_count": len(data)}

@router.post("/query")
async def natural_language_query(req: QueryRequest):
    init_db()
    conn = get_connection()
    try:
        schema_cols = get_table_schema(conn, req.table_name)
        if not schema_cols:
            raise HTTPException(status_code=404, detail="Table not found.")

        # Handle schema/metadata questions directly without SQL
        schema_keywords = ['column', 'columns', 'fields', 'schema', 'structure', 
                        'what is in', 'what data', 'describe', 'available']
        q_lower = req.question.lower()
        if any(kw in q_lower for kw in schema_keywords):
            col_list = ', '.join([f"{c['name']} ({c['type']})" for c in schema_cols])
            return {
                "question": req.question,
                "sql": f"PRAGMA table_info({req.table_name});",
                "schema": build_schema_context(req.table_name, schema_cols),
                "result": {
                    "columns": [{"name": "column_name", "type": "text"}, {"name": "data_type", "type": "text"}],
                    "rows": [{"column_name": c['name'], "data_type": c['type']} for c in schema_cols],
                    "row_count": len(schema_cols)
                },
                "chart_suggestion": {"chart_type": "bar", "x_column": "column_name", "y_column": "data_type", "reason": "Schema overview"}
            }
        
        schema_context = build_schema_context(req.table_name, schema_cols)
        prompt_text = build_prompt(schema_context, req.question)
        
        try:
            start = time.time()
            raw_response = generate_sql(prompt_text, req.provider or "ollama", req.api_key, req.model)
            llm_ms = int((time.time() - start) * 1000)
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"LLM error: {str(e)}")
        
        sql = extract_sql_from_response(raw_response)
        valid, reason = validate_sql(sql)
        if not valid:
            raise HTTPException(status_code=400, detail=f"SQL validation failed: {reason}")
        
        try:
            start = time.time()
            result = execute_query(conn, sql)
            exec_ms = int((time.time() - start) * 1000)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"SQL execution error: {str(e)}")
        
        # Chart suggestion
        chart = heuristic_chart(result['columns'], result['row_count'])

        # Location detection
        location = detect_location_type(result['columns'])
        
        conn.execute("""
            INSERT INTO query_history (table_name, question, sql_query, row_count, execution_ms)
            VALUES (?, ?, ?, ?, ?)
        """, (req.table_name, req.question, sql, result['row_count'], exec_ms))
        conn.commit()
        
        return {
            "question": req.question,
            "sql": sql,
            "schema": schema_context,
            "result": result,
            "chart_suggestion": chart,
            "location_info": location,
            "timing": {"llm_ms": llm_ms, "exec_ms": exec_ms}
        }
    finally:
        conn.close()

@router.post("/query/multi-table")
async def multi_table_query(req: MultiTableQueryRequest):
    init_db()
    conn = get_connection()
    try:
        from utils.llm import build_multi_schema_context
        schemas = []
        for tname in req.table_names:
            cols = get_table_schema(conn, tname)
            if cols:
                schemas.append({"table_name": tname, "columns": cols})
        
        if not schemas:
            raise HTTPException(status_code=404, detail="No valid tables found.")
        
        schema_context = build_multi_schema_context(schemas)
        prompt_text = build_prompt(schema_context, req.question)
        
        try:
            raw_response = generate_sql(prompt_text, req.provider or "ollama", req.api_key, req.model)
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"LLM error: {str(e)}")
        
        sql = extract_sql_from_response(raw_response)
        valid, reason = validate_sql(sql)
        if not valid:
            raise HTTPException(status_code=400, detail=f"SQL validation failed: {reason}")
        
        try:
            result = execute_query(conn, sql)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"SQL execution error: {str(e)}")
        
        chart = heuristic_chart(result['columns'], result['row_count'])
        
        return {"question": req.question, "sql": sql, "result": result, "chart_suggestion": chart}
    finally:
        conn.close()

@router.post("/query/fix-sql")
async def fix_broken_sql(req: FixSQLRequest):
    init_db()
    conn = get_connection()
    try:
        schema_cols = get_table_schema(conn, req.table_name)
        schema_context = build_schema_context(req.table_name, schema_cols)
        fixed = fix_sql(req.broken_sql, schema_context, req.error_message, req.provider or "ollama", req.api_key, req.model)
        sql = extract_sql_from_response(fixed)
        valid, reason = validate_sql(sql)
        if not valid:
            raise HTTPException(status_code=400, detail=f"Fixed SQL still invalid: {reason}")
        result = execute_query(conn, sql)
        return {"original_sql": req.broken_sql, "fixed_sql": sql, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()

@router.post("/query/execute")
async def execute_direct_sql(req: DirectSQLRequest):
    init_db()
    valid, reason = validate_sql(req.sql)
    if not valid:
        raise HTTPException(status_code=400, detail=f"SQL validation failed: {reason}")
    conn = get_connection()
    try:
        result = execute_query(conn, req.sql)
        chart = heuristic_chart(result['columns'], result['row_count'])
        conn.execute("""
            INSERT INTO query_history (table_name, question, sql_query, row_count)
            VALUES (?, ?, ?, ?)
        """, (req.table_name, "[Direct SQL]", req.sql, result['row_count']))
        conn.commit()
        return {"sql": req.sql, "result": result, "chart_suggestion": chart}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL error: {str(e)}")
    finally:
        conn.close()

@router.get("/query/history")
async def get_history():
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM query_history ORDER BY created_at DESC LIMIT 100")
        return {"history": [dict(r) for r in cursor.fetchall()]}
    finally:
        conn.close()

@router.delete("/query/history")
async def clear_history():
    init_db()
    conn = get_connection()
    try:
        conn.execute("DELETE FROM query_history")
        conn.commit()
        return {"message": "History cleared."}
    finally:
        conn.close()

class ExportRequest(BaseModel):
    sql: str
    table_name: str
    filename: Optional[str] = "prism_export"
    format: Optional[str] = "xlsx"  # xlsx or csv

@router.post("/query/export")
async def export_results(req: ExportRequest):
    import pandas as pd

    valid, reason = validate_sql(req.sql)
    if not valid:
        raise HTTPException(status_code=400, detail=f"SQL validation failed: {reason}")

    conn = get_connection()
    try:
        df = pd.read_sql_query(req.sql, conn)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query error: {str(e)}")
    finally:
        conn.close()

    filename = req.filename.strip() or "prism_export"

    if req.format == "csv":
        output = io.StringIO()
        df.to_csv(output, index=False)
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}.csv"}
        )
    else:
        # Excel export
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            df.to_excel(writer, index=False, sheet_name='Results')
            workbook  = writer.book
            worksheet = writer.sheets['Results']

            # Style the header row
            header_fmt = workbook.add_format({
                'bold': True,
                'bg_color': '#1c2030',
                'font_color': '#4ade80',
                'border': 1,
                'border_color': '#2a2e42'
            })
            data_fmt = workbook.add_format({
                'border': 1,
                'border_color': '#2a2e42'
            })

            # Apply header format
            for col_num, col_name in enumerate(df.columns):
                worksheet.write(0, col_num, col_name, header_fmt)
                # Auto-fit column width
                col_width = max(len(str(col_name)), df[col_name].astype(str).str.len().max())
                worksheet.set_column(col_num, col_num, min(col_width + 4, 40))

        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"}
        )
