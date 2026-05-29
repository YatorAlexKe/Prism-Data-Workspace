from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.sql_validator import sanitize_table_name, sanitize_column_name
from utils.sheets import read_sheet, write_sheet

router = APIRouter()

class SheetImportRequest(BaseModel):
    url: str
    sheet_name: Optional[str] = None
    project_id: Optional[int] = None

class SheetExportRequest(BaseModel):
    sql: str
    url: str
    sheet_name: Optional[str] = "Prism Export"

@router.post("/sheets/import")
async def import_from_sheets(req: SheetImportRequest):
    init_db()
    try:
        df, available_sheets = read_sheet(req.url, req.sheet_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read sheet: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="Sheet is empty.")

    df.columns = [sanitize_column_name(c) for c in df.columns]

    for col in df.columns:
        try:
            df[col] = df[col].apply(lambda x: float(x) if x != '' else None)
        except (ValueError, TypeError):
            pass

    table_name = sanitize_table_name(f"sheet_{req.url.split('/')[-2][:20]}")

    conn = get_connection()
    try:
        df.to_sql(table_name, conn, if_exists='replace', index=False)
        conn.execute("""
            INSERT OR REPLACE INTO datasets
            (name, table_name, original_filename, source_type, source_url, row_count, col_count, file_format)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, ("Google Sheet", table_name, req.url, 'google_sheets',
              req.url, len(df), len(df.columns), 'google_sheets'))
        conn.commit()
    finally:
        conn.close()

    schema = [{"name": c, "type": "text"} for c in df.columns]

    return {
        "table_name": table_name,
        "row_count": len(df),
        "columns": schema,
        "available_sheets": available_sheets,
        "preview": df.head(5).fillna("").to_dict(orient='records')
    }

@router.post("/sheets/export")
async def export_to_sheets(req: SheetExportRequest):
    from utils.sql_validator import validate_sql
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

    try:
        message = write_sheet(req.url, df, req.sheet_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write to sheet: {str(e)}")

    return {
        "message": message,
        "rows_written": len(df),
        "sheet_name": req.sheet_name
    }

@router.get("/sheets/service-account-email")
async def get_service_account_email():
    import json
    creds_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        '..', 'credentials', 'service_account.json'
    )
    try:
        with open(os.path.abspath(creds_path)) as f:
            data = json.load(f)
        return {"email": data.get("client_email", "Not found")}
    except FileNotFoundError:
        raise HTTPException(status_code=404,
            detail="Service account credentials not found.")