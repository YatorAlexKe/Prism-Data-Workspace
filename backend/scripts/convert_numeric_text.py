"""Convert numbers stored as text in existing datasets into real numbers.

Datasets imported before numeric coercion was added to ingestion (OCR, Google
Sheets, CSVs with "$1,234" or "45%") can hold numbers as TEXT, which SQL sorts
alphabetically ('98.58' > '214.30'). This applies the same rules new imports
use (utils.ingestion._coerce_numeric) to every dataset table.

    cd backend
    venv\\Scripts\\python.exe scripts/convert_numeric_text.py            # dry run: list changes
    venv\\Scripts\\python.exe scripts/convert_numeric_text.py --apply    # back up, then convert

--apply first writes a consistent backup to database/backups/ (safe while the
server is running). Only columns where every non-empty value parses as a
number are converted; leading-zero codes like '01234' are left as text.
Restart the server afterwards so cached table descriptions are rebuilt.
"""
import argparse
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd  # noqa: E402
from utils.db import DB_PATH  # noqa: E402
from utils.ingestion import _coerce_numeric, _is_text  # noqa: E402


def backup(db_path: str) -> str:
    folder = os.path.join(os.path.dirname(db_path), 'backups')
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, f"prism-{time.strftime('%Y%m%d-%H%M%S')}.db")
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(dest)
    with dst:
        src.backup(dst)  # online backup API: consistent even with the server running
    dst.close()
    src.close()
    return dest


def plan(conn):
    """{table: [(column, example_before, example_after)]} for convertible columns."""
    changes = {}
    tables = [r[0] for r in conn.execute("SELECT table_name FROM datasets ORDER BY table_name")]
    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in tables:
        if table not in existing:
            continue
        text_cols = [c[1] for c in conn.execute(f'PRAGMA table_info("{table}")') if (c[2] or 'TEXT').upper() == 'TEXT']
        if not text_cols:
            continue
        df = pd.read_sql_query(f'SELECT {", ".join(f"[{c}]" for c in text_cols)} FROM "{table}"', conn)
        found = []
        for col in text_cols:
            series = df[col].map(lambda v: None if isinstance(v, str) and not v.strip() else v)
            if not _is_text(series) and series.notna().any():
                continue
            converted = _coerce_numeric(series)
            if converted is not None:
                i = series.first_valid_index()
                found.append((col, series[i], converted[i]))
        if found:
            changes[table] = found
    return changes


def apply(conn, table: str, columns: list):
    df = pd.read_sql_query(f'SELECT * FROM "{table}"', conn)
    for col in columns:
        series = df[col].map(lambda v: None if isinstance(v, str) and not v.strip() else v)
        df[col] = _coerce_numeric(series)
    df.to_sql(table, conn, if_exists='replace', index=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.abspath(DB_PATH))
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    changes = plan(conn)
    if not changes:
        print("Nothing to convert.")
        return
    for table, cols in changes.items():
        print(f"{table}:")
        for col, before, after in cols:
            print(f"  {col}: {before!r} -> {after}")
    if not args.apply:
        print("\nDry run only. Re-run with --apply to back up and convert.")
        return

    path = backup(args.db)
    print(f"\nBackup written: {path}")
    for table, cols in changes.items():
        apply(conn, table, [c[0] for c in cols])
        print(f"converted {table} ({len(cols)} column{'s' if len(cols) != 1 else ''})")
    conn.commit()
    conn.close()
    print("Done. Restart the server so cached table descriptions are rebuilt.")


if __name__ == '__main__':
    main()
