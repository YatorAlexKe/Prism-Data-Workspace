from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.db import get_connection, init_db
from utils.profiler import profile_dataframe
from utils.sql_validator import sanitize_column_name
from utils.nl2sql import invalidate_description
import pandas as pd

router = APIRouter()

# Cap how many rows the edit modal will load. Rendering N×M <input> elements
# in the browser is the bottleneck — 500 rows × 20 cols ≈ 10k inputs already
# feels sluggish. Larger datasets get a "first N shown" warning in the UI.
EDIT_ROW_LIMIT = 500


class ColumnRename(BaseModel):
    old: str
    new: str


class DatasetUpdate(BaseModel):
    rows: List[dict]
    column_renames: Optional[List[ColumnRename]] = None


def _verify_table_exists(conn, table_name: str):
    """Guard against arbitrary table_name being used in f-string SQL by
    confirming the name is one we registered in the datasets metadata."""
    row = conn.execute(
        "SELECT 1 FROM datasets WHERE table_name=?", (table_name,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Dataset '{table_name}' not found.")

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

@router.get("/datasets/{table_name}/rows")
async def get_dataset_rows(table_name: str):
    """Return up to EDIT_ROW_LIMIT rows of a dataset, ordered for stable
    re-rendering. Used by the dataset edit modal."""
    init_db()
    conn = get_connection()
    try:
        _verify_table_exists(conn, table_name)

        info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        columns = [{"name": c['name'], "type": c['type'] or 'text'} for c in info]

        total = conn.execute(f"SELECT COUNT(*) AS c FROM {table_name}").fetchone()['c']

        rows_cursor = conn.execute(f"SELECT rowid, * FROM {table_name} LIMIT ?", (EDIT_ROW_LIMIT,))
        rows = []
        for r in rows_cursor.fetchall():
            d = {k: ('' if v is None else v) for k, v in dict(r).items() if k != 'rowid'}
            d['_rowid'] = r['rowid']
            rows.append(d)

        return {
            "table_name": table_name,
            "columns": columns,
            "rows": rows,
            "total_rows": total,
            "returned_rows": len(rows),
            "capped": total > EDIT_ROW_LIMIT,
            "limit": EDIT_ROW_LIMIT,
        }
    finally:
        conn.close()


@router.put("/datasets/{table_name}/rows")
async def replace_dataset_rows(table_name: str, payload: DatasetUpdate):
    """Replace the dataset's rows with the provided list and optionally rename
    columns. Wipes existing rows and re-inserts; updates datasets metadata.

    Column renames are applied via ALTER TABLE RENAME COLUMN (requires SQLite
    3.25+). The frontend keeps row keys at the ORIGINAL column names, so we
    map original→new by position when re-inserting.

    If the dataset has more than EDIT_ROW_LIMIT rows, the caller would only
    have loaded the first EDIT_ROW_LIMIT — we capture the un-edited tail
    before any change and re-insert it after."""
    init_db()
    conn = get_connection()
    try:
        _verify_table_exists(conn, table_name)

        # Snapshot of original column list + tail rows BEFORE renames so the
        # frontend payload's row keys (which use original names) still match.
        original_info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        if not original_info:
            raise HTTPException(status_code=404, detail="Table not found.")
        original_columns = [c['name'] for c in original_info]

        total = conn.execute(f"SELECT COUNT(*) AS c FROM {table_name}").fetchone()['c']
        tail_rows = []
        if total > EDIT_ROW_LIMIT:
            tail_cursor = conn.execute(
                f"SELECT * FROM {table_name} LIMIT -1 OFFSET ?", (EDIT_ROW_LIMIT,)
            )
            tail_rows = [dict(r) for r in tail_cursor.fetchall()]

        # Validate + apply column renames.
        if payload.column_renames:
            untouched = set(original_columns) - {r.old for r in payload.column_renames}
            seen_new = set()
            sanitized_renames = []
            for r in payload.column_renames:
                if r.old not in original_columns:
                    raise HTTPException(status_code=400, detail=f"Unknown column '{r.old}'.")
                new = sanitize_column_name(r.new)
                if not new:
                    raise HTTPException(status_code=400, detail=f"Invalid column name '{r.new}'.")
                if new in seen_new or new in untouched:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Column name '{new}' conflicts with another column."
                    )
                seen_new.add(new)
                sanitized_renames.append((r.old, new))
            for old, new in sanitized_renames:
                if old != new:
                    conn.execute(
                        f'ALTER TABLE "{table_name}" RENAME COLUMN "{old}" TO "{new}"'
                    )

        # Get post-rename column list. SQLite preserves column order across
        # RENAME COLUMN, so position i maps original_columns[i] → new_columns[i].
        new_info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        new_columns = [c['name'] for c in new_info]

        conn.execute(f"DELETE FROM {table_name}")

        cols_sql = ', '.join(f'"{c}"' for c in new_columns)
        placeholders = ', '.join(['?'] * len(new_columns))
        insert_sql = f'INSERT INTO "{table_name}" ({cols_sql}) VALUES ({placeholders})'

        def _row_values(row):
            # row is keyed by ORIGINAL column names — map to new by position.
            return [
                None if (row.get(orig) == '' or row.get(orig) is None) else row[orig]
                for orig in original_columns
            ]

        for row in payload.rows:
            conn.execute(insert_sql, _row_values(row))
        for row in tail_rows:
            conn.execute(insert_sql, _row_values(row))

        new_count = len(payload.rows) + len(tail_rows)
        conn.execute(
            "UPDATE datasets SET row_count=?, col_count=? WHERE table_name=?",
            (new_count, len(new_columns), table_name),
        )
        conn.commit()
        invalidate_description(table_name)
        return {
            "message": "Dataset updated.",
            "row_count": new_count,
            "col_count": len(new_columns),
            "columns": new_columns,
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update dataset: {e}")
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
        invalidate_description(table_name)
        return {"message": f"Dataset {table_name} deleted."}
    finally:
        conn.close()
