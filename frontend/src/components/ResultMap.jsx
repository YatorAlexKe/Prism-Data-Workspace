import { useEffect, useRef, useState } from 'react';

export default function ResultMap({ result, locationInfo }) {
  const divRef = useRef(null);
  const fullscreenRef = useRef(null);
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const target = fullscreen ? fullscreenRef.current : divRef.current;
    if (!target || !result?.rows?.length || !window.Plotly) return;
    
    try {
      if (locationInfo?.type === 'coordinates') {
        drawScatterMap(target, result, locationInfo, fullscreen);
      } else if (locationInfo?.type === 'country') {
        drawChoroplethMap(target, result, locationInfo, fullscreen);
      } else if (locationInfo?.type === 'region') {
        drawBubbleMap(target, result, locationInfo, fullscreen);
      }
    } catch(e) {
      setError(e.message);
    }
  }, [result, locationInfo, fullscreen]);

  if (!locationInfo?.type) return null;

  if (!result?.rows?.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🗺️</div>
        <div className="empty-text">No data to map</div>
      </div>
    );
  }

  const layout = {
    paper_bgcolor: '#141720',
    plot_bgcolor: '#141720',
    font: { color: '#e2e8f0', family: 'IBM Plex Mono, monospace', size: 11 },
    margin: { t: 20, r: 20, b: 20, l: 20 },
    height: 420,
  };

  return (
    <div>
      {fullscreen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: '#0d0f14',
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface)'
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🗺️</span>
              <span>
                {locationInfo.type === 'coordinates' && `Plotting ${result.row_count} points by coordinates`}
                {locationInfo.type === 'country' && `World map by ${locationInfo.location_col}`}
                {locationInfo.type === 'region' && `Regional map by ${locationInfo.location_col}`}
              </span>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => setFullscreen(false)}
            >
              ← Back to Results
            </button>
          </div>
          <div ref={fullscreenRef} style={{ flex: 1 }} />
        </div>
      )}

      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>⚠ Map error: {error}</div>
      )}
      <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🗺️</span>
          <span>
            {locationInfo.type === 'coordinates' && `Plotting ${result.row_count} points by coordinates`}
            {locationInfo.type === 'country' && `World map by ${locationInfo.location_col}`}
            {locationInfo.type === 'region' && `Regional map by ${locationInfo.location_col}`}
          </span>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setFullscreen(true)}
          title="Fullscreen map"
        >
          ⛶ Maximize
        </button>
      </div>
      <div ref={divRef} />
    </div>
  );
}

function getNumericCol(result) {
  const cols = result.columns.map(c => c.name || c);
  return cols.find(c => {
    const vals = result.rows.map(r => r[c]);
    return vals.some(v => !isNaN(parseFloat(v)));
  }) || cols[cols.length - 1];
}

function drawScatterMap(target, result, locationInfo, fullscreen = false) {
  const h = fullscreen ? window.innerHeight - 80 : 420;
  const cols = result.columns.map(c => c.name || c);
  const latCol = cols.find(c => c.toLowerCase() === locationInfo.lat_col);
  const lonCol = cols.find(c => c.toLowerCase() === locationInfo.lon_col);
  const numCol = getNumericCol(result);
  const textCol = cols.find(c => c !== latCol && c !== lonCol && c !== numCol) || cols[0];

  const lats = result.rows.map(r => parseFloat(r[latCol])).filter(v => !isNaN(v));
  const lons = result.rows.map(r => parseFloat(r[lonCol])).filter(v => !isNaN(v));
  const vals = result.rows.map(r => parseFloat(r[numCol]) || 0);
  const texts = result.rows.map(r => `${r[textCol]}<br>${numCol}: ${r[numCol]}`);

  const trace = {
    type: 'scattergeo',
    lat: lats,
    lon: lons,
    text: texts,
    hoverinfo: 'text',
    marker: {
      size: vals.map(v => Math.max(6, Math.min(30, (v / Math.max(...vals)) * 30))),
      color: vals,
      colorscale: [
        [0, '#1a4a2a'],
        [0.5, '#2d8a4e'],
        [1, '#4ade80']
      ],
      showscale: true,
      colorbar: {
        title: numCol,
        titlefont: { color: '#e2e8f0', size: 10 },
        tickfont: { color: '#e2e8f0', size: 9 },
        bgcolor: '#141720',
        bordercolor: '#2a2e42'
      }
    }
  };

  const layout = {
    paper_bgcolor: '#141720',
    font: { color: '#e2e8f0', family: 'IBM Plex Mono', size: 10 },
    margin: { t: 10, r: 10, b: 10, l: 10 },
    height: h,
    geo: {
      bgcolor: '#0d0f14',
      landcolor: '#1c2030',
      oceancolor: '#0d0f14',
      lakecolor: '#0d0f14',
      countrycolor: '#2a2e42',
      coastlinecolor: '#2a2e42',
      showland: true,
      showocean: true,
      showlakes: true,
      showcoastlines: true,
      showcountries: true,
      projection: { type: 'natural earth' },
      fitbounds: 'locations'
    }
  };

  window.Plotly.newPlot(target, [trace], layout, { responsive: true, displayModeBar: false });
}

function drawChoroplethMap(target, result, locationInfo, fullscreen = false) {
  const h = fullscreen ? window.innerHeight - 80 : 420;
  const cols = result.columns.map(c => c.name || c);
  const locCol = cols.find(c => c.toLowerCase() === locationInfo.location_col) || cols[0];
  const numCol = getNumericCol(result);

  const locations = result.rows.map(r => r[locCol]);
  const values = result.rows.map(r => parseFloat(r[numCol]) || 0);
  const texts = result.rows.map(r => `${r[locCol]}<br>${numCol}: ${r[numCol]}`);

  const trace = {
    type: 'choropleth',
    locations: locations,
    z: values,
    text: texts,
    hoverinfo: 'text',
    locationmode: 'country names',
    colorscale: [
      [0, '#1a4a2a'],
      [0.5, '#2d8a4e'],
      [1, '#4ade80']
    ],
    colorbar: {
      title: numCol,
      titlefont: { color: '#e2e8f0', size: 10 },
      tickfont: { color: '#e2e8f0', size: 9 },
      bgcolor: '#141720',
      bordercolor: '#2a2e42'
    },
    marker: { line: { color: '#2a2e42', width: 0.5 } }
  };

  const layout = {
    paper_bgcolor: '#141720',
    font: { color: '#e2e8f0', family: 'IBM Plex Mono', size: 10 },
    margin: { t: 10, r: 10, b: 10, l: 10 },
    height: h,
    geo: {
      bgcolor: '#0d0f14',
      landcolor: '#1c2030',
      oceancolor: '#0d0f14',
      showland: true,
      showocean: true,
      showcountries: true,
      showcoastlines: true,
      countrycolor: '#2a2e42',
      coastlinecolor: '#2a2e42',
      projection: { type: 'natural earth' }
    }
  };

  window.Plotly.newPlot(target, [trace], layout, { responsive: true, displayModeBar: false });
}

function drawBubbleMap(target, result, locationInfo, fullscreen = false) {
  const h = fullscreen ? window.innerHeight - 80 : 420;
  const cols = result.columns.map(c => c.name || c);
  const locCol = cols.find(c => c.toLowerCase() === locationInfo.location_col) || cols[0];
  const numCol = getNumericCol(result);

  const locations = result.rows.map(r => r[locCol]);
  const values = result.rows.map(r => parseFloat(r[numCol]) || 0);
  const texts = result.rows.map(r => `${r[locCol]}<br>${numCol}: ${r[numCol]}`);

  const trace = {
    type: 'choropleth',
    locations: locations,
    z: values,
    text: texts,
    hoverinfo: 'text',
    locationmode: 'country names',
    colorscale: [
      [0, '#1a1a2e'],
      [0.5, '#2d4a8a'],
      [1, '#60a5fa']
    ],
    colorbar: {
      title: numCol,
      titlefont: { color: '#e2e8f0', size: 10 },
      tickfont: { color: '#e2e8f0', size: 9 },
      bgcolor: '#141720',
      bordercolor: '#2a2e42'
    },
    marker: { line: { color: '#2a2e42', width: 0.5 } }
  };

  const layout = {
    paper_bgcolor: '#141720',
    font: { color: '#e2e8f0', family: 'IBM Plex Mono', size: 10 },
    margin: { t: 10, r: 10, b: 10, l: 10 },
    height: h,
    geo: {
      bgcolor: '#0d0f14',
      landcolor: '#1c2030',
      oceancolor: '#0d0f14',
      showland: true,
      showocean: true,
      showcountries: true,
      showcoastlines: true,
      countrycolor: '#2a2e42',
      coastlinecolor: '#2a2e42',
      projection: { type: 'natural earth' }
    }
  };

  window.Plotly.newPlot(target, [trace], layout, { responsive: true, displayModeBar: false });
}