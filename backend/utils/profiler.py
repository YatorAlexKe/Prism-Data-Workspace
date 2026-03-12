import pandas as pd
import math

def profile_dataframe(df: pd.DataFrame, table_name: str) -> dict:
    total_rows = len(df)
    total_cells = total_rows * len(df.columns)
    total_nulls = df.isnull().sum().sum()
    duplicate_rows = df.duplicated().sum()
    
    columns = []
    quality_scores = []
    
    for col in df.columns:
        series = df[col]
        null_count = int(series.isnull().sum())
        null_pct = round((null_count / total_rows * 100), 1) if total_rows > 0 else 0
        unique_count = int(series.nunique())
        
        dtype = str(series.dtype)
        if 'int' in dtype:
            col_type = 'integer'
        elif 'float' in dtype:
            col_type = 'float'
        elif 'datetime' in dtype:
            col_type = 'datetime'
        else:
            col_type = 'text'
        
        col_profile = {
            "name": col,
            "type": col_type,
            "null_count": null_count,
            "null_pct": null_pct,
            "unique_count": unique_count,
            "unique_pct": round(unique_count / total_rows * 100, 1) if total_rows > 0 else 0,
        }
        
        # Numeric stats
        if col_type in ('integer', 'float'):
            numeric = pd.to_numeric(series, errors='coerce')
            col_profile.update({
                "min": _safe_val(numeric.min()),
                "max": _safe_val(numeric.max()),
                "mean": _safe_val(numeric.mean()),
                "median": _safe_val(numeric.median()),
                "std": _safe_val(numeric.std()),
            })
        else:
            # Top values for text
            top_vals = series.value_counts().head(5)
            col_profile["top_values"] = [
                {"value": str(k), "count": int(v)} 
                for k, v in top_vals.items()
            ]
        
        # Quality score per column (0-100)
        col_quality = 100 - null_pct
        quality_scores.append(col_quality)
        col_profile["quality_score"] = round(col_quality, 1)
        
        columns.append(col_profile)
    
    # Overall quality score
    overall_quality = round(sum(quality_scores) / len(quality_scores), 1) if quality_scores else 0
    
    # Warnings
    warnings = []
    if duplicate_rows > 0:
        warnings.append(f"{duplicate_rows} duplicate rows detected")
    if total_nulls > 0:
        null_pct_overall = round(total_nulls / total_cells * 100, 1)
        if null_pct_overall > 10:
            warnings.append(f"{null_pct_overall}% of all values are missing")
    high_null_cols = [c['name'] for c in columns if c['null_pct'] > 50]
    if high_null_cols:
        warnings.append(f"High nulls (>50%) in: {', '.join(high_null_cols)}")
    
    return {
        "table_name": table_name,
        "row_count": total_rows,
        "col_count": len(df.columns),
        "duplicate_rows": int(duplicate_rows),
        "total_nulls": int(total_nulls),
        "quality_score": overall_quality,
        "warnings": warnings,
        "columns": columns
    }

def _safe_val(val):
    if val is None:
        return None
    try:
        if math.isnan(float(val)) or math.isinf(float(val)):
            return None
        return round(float(val), 4)
    except Exception:
        return None
