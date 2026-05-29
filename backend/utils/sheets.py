from google.oauth2 import service_account
from googleapiclient.discovery import build
import pandas as pd
import os
import re

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
]

CREDENTIALS_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'credentials', 'service_account.json'
)

def get_sheets_service():
    creds = service_account.Credentials.from_service_account_file(
        os.path.abspath(CREDENTIALS_PATH), scopes=SCOPES
    )
    return build('sheets', 'v4', credentials=creds)

def extract_sheet_id(url: str) -> str:
    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
    if not match:
        raise ValueError("Invalid Google Sheets URL")
    return match.group(1)

def read_sheet(url: str, sheet_name: str = None):
    try:
        service = get_sheets_service()
    except Exception as e:
        raise Exception(f"Auth error: {str(e)}")
    
    sheet_id = extract_sheet_id(url)
    
    try:
        meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    except Exception as e:
        raise Exception(f"Cannot access sheet: {str(e)}")
    
    sheets = [s['properties']['title'] for s in meta['sheets']]
    tab = sheet_name or sheets[0]
    
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=sheet_id,
            range=tab
        ).execute()
    except Exception as e:
        raise Exception(f"Cannot read values: {str(e)}")
    
    values = result.get('values', [])
    if not values:
        raise ValueError("Sheet is empty")
    
    headers = values[0]
    rows = values[1:]
    rows = [r + [''] * (len(headers) - len(r)) for r in rows]
    df = pd.DataFrame(rows, columns=headers)
    return df, sheets

def write_sheet(url: str, df: pd.DataFrame, sheet_name: str = "Prism Export") -> str:
    service = get_sheets_service()
    sheet_id = extract_sheet_id(url)

    # Check if tab exists, create if not
    meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    existing = [s['properties']['title'] for s in meta['sheets']]

    if sheet_name not in existing:
        service.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={'requests': [{'addSheet': {'properties': {'title': sheet_name}}}]}
        ).execute()

    # Prepare data
    headers = df.columns.tolist()
    rows = df.fillna('').astype(str).values.tolist()
    values = [headers] + rows

    # Clear and write
    service.spreadsheets().values().clear(
        spreadsheetId=sheet_id,
        range=sheet_name
    ).execute()

    service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A1",
        valueInputOption='RAW',
        body={'values': values}
    ).execute()

    return f"Successfully wrote {len(df)} rows to '{sheet_name}' tab"