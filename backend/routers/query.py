from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import time, sys, os, io
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.sql_validator import validate_sql, extract_sql_from_response
from utils.llm import build_schema_context, fix_sql
from utils.nl2sql import answer, is_schema_question, sqlite_runner, suggest_questions, NLQueryError
from utils.chart_advisor import heuristic_chart

router = APIRouter()

class PreviousTurn(BaseModel):
    """The last answered question, so a follow-up ("now only North") can build on it."""
    question: str
    sql: Optional[str] = None

class QueryRequest(BaseModel):
    table_name: str
    question: str
    provider: Optional[str] = "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None
    previous: Optional[PreviousTurn] = None
    allow_clarify: Optional[bool] = True

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
    previous: Optional[PreviousTurn] = None
    allow_clarify: Optional[bool] = True

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

# Rows sent to the browser per result. Bigger results are cut here (the
# table can't usefully show more and the JSON gets huge); CSV/Excel export
# re-runs the SQL and still downloads everything.
DISPLAY_ROWS = 1000

def execute_query(conn, sql: str) -> dict:
    cursor = conn.execute(sql)
    rows = cursor.fetchmany(DISPLAY_ROWS + 1)
    truncated = len(rows) > DISPLAY_ROWS
    names = [d[0] for d in cursor.description] if cursor.description else []
    return capped_result(conn, sql, names, rows[:DISPLAY_ROWS], truncated)

def count_rows(conn, sql: str):
    try:
        return conn.execute(f"SELECT COUNT(*) FROM ({sql.strip().rstrip(';')}) AS q").fetchone()[0]
    except Exception:
        return None

def capped_result(conn, sql: str, col_names: list, rows: list, truncated: bool) -> dict:
    result = format_result(col_names, rows)
    result["truncated"] = truncated
    result["total_count"] = count_rows(conn, sql) if truncated else result["row_count"]
    return result

def format_result(col_names: list, rows: list) -> dict:
    if not rows:
        return {"columns": [], "rows": [], "row_count": 0}
    columns = [{"name": n, "type": "text"} for n in col_names]
    data = [{col['name']: (val if val is not None else "") for col, val in zip(columns, row)} for row in rows]
    return {"columns": columns, "rows": data, "row_count": len(data)}

def log_failure(conn, table_name: str, question: str, err: NLQueryError, provider: str, model: str):
    try:
        conn.execute("""
            INSERT INTO query_failures (table_name, question, sql_query, stage, error, provider, model)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (table_name, question, err.sql, err.stage, err.message, provider, model))
        conn.commit()
    except Exception:
        pass  # logging must never mask the user's real error

def clarification_response(question: str, out: dict) -> dict:
    # Nothing ran: the user picks one of the options, which is asked as a new question.
    return {"question": question, "clarification": out["clarification"], "interpretation": out["interpretation"]}

def nl_error_response(err: NLQueryError) -> HTTPException:
    # Same status codes and detail prefixes the frontend already shows.
    status = 503 if err.stage == 'llm' else 400
    return HTTPException(status_code=status, detail=err.message)

@router.post("/query")
async def natural_language_query(req: QueryRequest):
    init_db()
    conn = get_connection()
    try:
        schema_cols = get_table_schema(conn, req.table_name)
        if not schema_cols:
            raise HTTPException(status_code=404, detail="Table not found.")

        # Questions about the table's structure are answered from the schema.
        if is_schema_question(req.question):
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
        
        provider = req.provider or "ollama"
        start = time.time()
        try:
            out = answer(req.question, [{"table_name": req.table_name, "columns": schema_cols}],
                         sqlite_runner(conn), 'sqlite', provider, req.api_key, req.model,
                         cache_key='sqlite', max_rows=DISPLAY_ROWS,
                         previous=dict(req.previous) if req.previous else None,
                         allow_clarify=req.allow_clarify is not False)
        except NLQueryError as e:
            log_failure(conn, req.table_name, req.question, e, provider, req.model)
            raise nl_error_response(e)
        if out.get("clarification"):
            return clarification_response(req.question, out)
        total_ms = int((time.time() - start) * 1000)
        sql = out["sql"]
        result = capped_result(conn, sql, out["columns"], out["rows"], out["truncated"])
        schema_context = out["schema"]

        # Chart suggestion
        chart = heuristic_chart(result['columns'], result['row_count'])

        # Location detection
        location = detect_location_type(result['columns'])
        
        conn.execute("""
            INSERT INTO query_history (table_name, question, sql_query, row_count, execution_ms)
            VALUES (?, ?, ?, ?, ?)
        """, (req.table_name, req.question, sql, result['total_count'] or result['row_count'], total_ms))
        conn.commit()

        return {
            "question": req.question,
            "sql": sql,
            "interpretation": out["interpretation"],
            "alternatives": out.get("alternatives", []),
            "repaired": bool(out["attempts"]),
            "schema": schema_context,
            "result": result,
            "chart_suggestion": chart,
            "location_info": location,
            "timing": {"total_ms": total_ms}
        }
    finally:
        conn.close()

@router.post("/query/multi-table")
async def multi_table_query(req: MultiTableQueryRequest):
    init_db()
    conn = get_connection()
    try:
        schemas = []
        for tname in req.table_names:
            cols = get_table_schema(conn, tname)
            if cols:
                schemas.append({"table_name": tname, "columns": cols})

        if not schemas:
            raise HTTPException(status_code=404, detail="No valid tables found.")

        provider = req.provider or "ollama"
        try:
            out = answer(req.question, schemas, sqlite_runner(conn), 'sqlite', provider, req.api_key, req.model,
                         cache_key='sqlite', max_rows=DISPLAY_ROWS,
                         previous=dict(req.previous) if req.previous else None,
                         allow_clarify=req.allow_clarify is not False)
        except NLQueryError as e:
            log_failure(conn, ','.join(req.table_names), req.question, e, provider, req.model)
            raise nl_error_response(e)
        if out.get("clarification"):
            return clarification_response(req.question, out)

        sql = out["sql"]
        result = capped_result(conn, sql, out["columns"], out["rows"], out["truncated"])
        chart = heuristic_chart(result['columns'], result['row_count'])

        return {"question": req.question, "sql": sql, "interpretation": out["interpretation"],
                "alternatives": out.get("alternatives", []),
                "repaired": bool(out["attempts"]), "result": result, "chart_suggestion": chart}
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
        """, (req.table_name, "[Direct SQL]", req.sql, result['total_count'] or result['row_count']))
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

@router.get("/query/suggestions/{table_name}")
async def get_suggestions(table_name: str):
    """Starter questions for an empty Query page, built from the table's columns."""
    init_db()
    conn = get_connection()
    try:
        cols = get_table_schema(conn, table_name)
        if not cols:
            raise HTTPException(status_code=404, detail="Table not found.")
        return {"table_name": table_name, "suggestions": suggest_questions(sqlite_runner(conn), table_name, cols)}
    finally:
        conn.close()

@router.get("/query/failures")
async def get_failures():
    """Questions that didn't produce a working query â€” for diagnosing accuracy."""
    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM query_failures ORDER BY created_at DESC LIMIT 100")
        return {"failures": [dict(r) for r in cursor.fetchall()]}
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
    format: Optional[str] = "xlsx"
    connection_id: Optional[int] = None  # xlsx or csv

@router.post("/query/export")
async def export_results(req: ExportRequest):
    import pandas as pd

    valid, reason = validate_sql(req.sql)
    if not valid:
        raise HTTPException(status_code=400, detail=f"SQL validation failed: {reason}")

    # Check if this is a MySQL connection export
    if req.connection_id:
        try:
            from utils.mysql_connector import get_connection as get_mysql_conn, decrypt_password
            from utils.db import get_connection as get_prism_db
            prism_conn = get_prism_db()
            cursor = prism_conn.execute(
                "SELECT * FROM db_connections WHERE id=?", (req.connection_id,)
            )
            details = cursor.fetchone()
            prism_conn.close()
            if not details:
                raise HTTPException(status_code=404, detail="Connection not found.")
            password = decrypt_password(details['encrypted_password'])
            mysql_conn = get_mysql_conn(
                details['host'], details['port'],
                details['database_name'], details['username'], password
            )
            try:
                df = pd.read_sql_query(req.sql, mysql_conn)
            finally:
                mysql_conn.close()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Query error: {str(e)}")
    else:
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
