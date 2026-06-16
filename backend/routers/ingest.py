from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import Optional
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.ingestion import parse_csv, parse_excel, parse_json, parse_url, clean_dataframe, get_schema
from utils.profiler import profile_dataframe
from utils.sql_validator import sanitize_table_name

router = APIRouter()

def store_dataframe(df, table_name, filename, source_type, project_id=None, source_url=None):
    df = clean_dataframe(df)
    schema = get_schema(df, table_name)
    profile = profile_dataframe(df, table_name)
    
    conn = get_connection()
    try:
        df.to_sql(table_name, conn, if_exists='replace', index=False)
        conn.execute("""
            INSERT OR REPLACE INTO datasets 
            (name, table_name, original_filename, source_type, source_url, row_count, col_count, file_format, project_id, data_quality_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (filename, table_name, filename, source_type, source_url,
              len(df), len(df.columns), source_type, project_id, profile['quality_score']))
        conn.commit()
    finally:
        conn.close()
    
    return {
        "table_name": table_name,
        "original_filename": filename,
        "row_count": len(df),
        "columns": schema,
        "profile": profile,
        "preview": df.head(5).fillna("").to_dict(orient='records')
    }

@router.post("/ingest/file")
async def ingest_file(
    file: UploadFile = File(...),
    project_id: Optional[int] = Form(None),
    sheet_name: Optional[str] = Form(None)
):
    init_db()
    filename = file.filename
    content = await file.read()
    ext = filename.lower().split('.')[-1]
    table_name = sanitize_table_name(filename.rsplit('.', 1)[0])
    
    try:
        if ext == 'csv':
            df = parse_csv(content)
        elif ext in ('xlsx', 'xls'):
            sheet = sheet_name or 0
            df, sheets = parse_excel(content, sheet)
            result = store_dataframe(df, table_name, filename, 'excel', project_id)
            result['sheets'] = sheets
            return result
        elif ext == 'json':
            df = parse_json(content)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file format: .{ext}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")
    
    return store_dataframe(df, table_name, filename, ext, project_id)

@router.post("/ingest/url")
async def ingest_url(payload: dict):
    init_db()
    url = payload.get('url', '').strip()
    project_id = payload.get('project_id')
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required.")
    
    try:
        df = parse_url(url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {str(e)}")
    
    # Use domain as table name
    from urllib.parse import urlparse
    domain = urlparse(url).netloc.replace('.', '_').replace('-', '_')
    table_name = sanitize_table_name(domain or 'url_data')
    
    return store_dataframe(df, table_name, url, 'url', project_id, source_url=url)

IMAGE_EXTS = {'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'webp'}

@router.post("/ingest/image")
async def ingest_image(
    file: UploadFile = File(...),
    project_id: Optional[int] = Form(None),
    table_index: Optional[int] = Form(0),
    min_confidence: int = Form(25),
    has_header: bool = Form(True),
    lang: str = Form('eng'),
    implicit_rows: bool = Form(False),
    isolate_table: bool = Form(True),
    unwrap_lines: bool = Form(True),
    confidence_backfill: bool = Form(True),
    backfill_min_confidence: int = Form(5),
):
    init_db()
    filename = file.filename or 'image'
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    if ext not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported image format: .{ext}")

    content = await file.read()

    from utils.image_ocr import extract_tables_from_image
    try:
        tables = extract_tables_from_image(
            content,
            min_confidence=min_confidence,
            lang=lang,
            has_header=has_header,
            implicit_rows=implicit_rows,
            isolate_table=isolate_table,
            unwrap_lines=unwrap_lines,
            confidence_backfill=confidence_backfill,
            backfill_min_confidence=backfill_min_confidence,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to OCR image: {e}")

    if not tables:
        raise HTTPException(status_code=400, detail="No tables detected in the image.")

    idx = table_index or 0
    if idx < 0 or idx >= len(tables):
        raise HTTPException(
            status_code=400,
            detail=f"table_index {idx} out of range (found {len(tables)} table(s))."
        )

    df = tables[idx]
    table_name = sanitize_table_name(filename.rsplit('.', 1)[0])
    result = store_dataframe(df, table_name, filename, 'image', project_id)
    result['tables_found'] = len(tables)
    result['table_index'] = idx
    return result

@router.get("/ingest/sheets")
async def get_excel_sheets(file: UploadFile = File(...)):
    content = await file.read()
    try:
        import pandas as pd
        import io
        xl = pd.ExcelFile(io.BytesIO(content))
        return {"sheets": xl.sheet_names}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
