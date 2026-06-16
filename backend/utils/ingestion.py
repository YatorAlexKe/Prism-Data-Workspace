import pandas as pd
import io
import json
import re
import requests
from utils.sql_validator import sanitize_column_name, sanitize_table_name

def parse_csv(content: bytes) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(content))

def parse_excel(content: bytes, sheet_name=0) -> tuple:
    xl = pd.ExcelFile(io.BytesIO(content))
    sheets = xl.sheet_names
    df = pd.read_excel(io.BytesIO(content), sheet_name=sheet_name)
    return df, sheets

def parse_json(content: bytes) -> pd.DataFrame:
    data = json.loads(content.decode('utf-8'))
    if isinstance(data, list):
        df = pd.json_normalize(data)
    elif isinstance(data, dict):
        # Try to find the main array in the dict
        for key, val in data.items():
            if isinstance(val, list) and len(val) > 0:
                df = pd.json_normalize(val)
                break
        else:
            df = pd.json_normalize([data])
    else:
        raise ValueError("Unsupported JSON structure")
    return df

def parse_url(url: str) -> pd.DataFrame:
    # Handle Google Sheets
    if 'docs.google.com/spreadsheets' in url:
        # Convert to CSV export URL
        if '/edit' in url:
            url = url.split('/edit')[0]
        if not url.endswith('/export'):
            url = url.rstrip('/') + '/export?format=csv'
    
    headers = {'User-Agent': 'Mozilla/5.0'}
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    
    content_type = response.headers.get('content-type', '')
    content = response.content
    
    if 'json' in content_type:
        return parse_json(content)
    elif 'excel' in content_type or url.endswith('.xlsx'):
        df, _ = parse_excel(content)
        return df
    else:
        # Default to CSV
        return pd.read_csv(io.BytesIO(content))

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    # Sanitize column names
    df.columns = [sanitize_column_name(c) for c in df.columns]
    # Deduplicate — sanitization can collide ("Total ($)" + "Total (%)" → "total"),
    # and OCR can yield repeated header text. Duplicate column labels make
    # df[col] return a DataFrame instead of a Series, which crashes downstream.
    df.columns = _dedupe_columns(df.columns)
    # Remove fully empty rows
    df = df.dropna(how='all')
    # Limit to 500k rows for performance
    if len(df) > 500000:
        df = df.head(500000)
    return df

def _dedupe_columns(cols) -> list:
    seen = {}
    out = []
    for c in cols:
        if c not in seen:
            seen[c] = 0
            out.append(c)
        else:
            seen[c] += 1
            out.append(f"{c}_{seen[c]}")
    return out

def get_col_type(series: pd.Series) -> str:
    dtype = str(series.dtype)
    if 'int' in dtype:
        return 'integer'
    elif 'float' in dtype:
        return 'float'
    elif 'datetime' in dtype:
        return 'datetime'
    elif 'bool' in dtype:
        return 'boolean'
    else:
        return 'text'

def get_schema(df: pd.DataFrame, table_name: str) -> list:
    schema = []
    for col in df.columns:
        schema.append({
            "name": col,
            "type": get_col_type(df[col])
        })
    return schema
