def get_column_types(columns: list) -> tuple:
    numeric = [c for c in columns if c['type'] in ('integer', 'float', 'REAL', 'INTEGER', 'NUMERIC')]
    text = [c for c in columns if c['type'] not in ('integer', 'float', 'REAL', 'INTEGER', 'NUMERIC')]
    return numeric, text

def heuristic_chart(columns: list, row_count: int) -> dict:
    numeric, text = get_column_types(columns)
    
    if not columns:
        return {"chart_type": "bar", "x_column": None, "y_column": None}
    
    # Single numeric column = histogram
    if len(numeric) == 1 and len(text) == 0:
        return {
            "chart_type": "histogram",
            "x_column": numeric[0]['name'],
            "y_column": numeric[0]['name'],
            "reason": "Single numeric column — distribution histogram"
        }
    
    # Two numeric columns = scatter
    if len(numeric) >= 2 and len(text) == 0:
        return {
            "chart_type": "scatter",
            "x_column": numeric[0]['name'],
            "y_column": numeric[1]['name'],
            "reason": "Two numeric columns — scatter plot"
        }
    
    # One text + one numeric, few rows = pie
    if len(text) >= 1 and len(numeric) >= 1 and row_count <= 8:
        return {
            "chart_type": "pie",
            "x_column": text[0]['name'],
            "y_column": numeric[0]['name'],
            "reason": "Few categories — pie chart"
        }
    
    # One text + one numeric, many rows = bar
    if len(text) >= 1 and len(numeric) >= 1:
        # Check if x might be time-based
        x_col = text[0]['name'].lower()
        if any(t in x_col for t in ['date', 'time', 'year', 'month', 'day', 'week']):
            return {
                "chart_type": "line",
                "x_column": text[0]['name'],
                "y_column": numeric[0]['name'],
                "reason": "Time-based x-axis — line chart"
            }
        return {
            "chart_type": "bar",
            "x_column": text[0]['name'],
            "y_column": numeric[0]['name'],
            "reason": "Categorical x-axis — bar chart"
        }
    
    # Fallback
    return {
        "chart_type": "bar",
        "x_column": columns[0]['name'],
        "y_column": columns[-1]['name'],
        "reason": "Default chart"
    }
