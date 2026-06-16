from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from routers import ingest, query, profile, projects, schema, sheets, connections

app = FastAPI(title="Prism — AI Data Workspace", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router,       prefix="/api", tags=["ingest"])
app.include_router(query.router,        prefix="/api", tags=["query"])
app.include_router(profile.router,      prefix="/api", tags=["profile"])
app.include_router(projects.router,     prefix="/api", tags=["projects"])
app.include_router(schema.router,       prefix="/api", tags=["schema"])
app.include_router(sheets.router,       prefix="/api", tags=["sheets"])
app.include_router(connections.router,  prefix="/api", tags=["connections"])

# The Vite build emits to frontend/dist/. In development you typically run
# `npm run dev` (Vite on :5173 with /api proxied here); the dist folder may
# not exist yet — that's fine, FastAPI just won't mount any static files
# and the JSON fallback at "/" serves as a health check.
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
assets_path = os.path.join(dist_path, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

@app.get("/")
async def root():
    index_path = os.path.join(dist_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Prism API running — run `npm run build` in frontend/ to serve the UI"}

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}

# Catch-all for client-side routes (/dashboard, /query, /ingest, …) so a hard
# refresh on any React Router path still returns the SPA shell. Must be defined
# AFTER the API routers so /api/* still hits the actual endpoints.
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    index_path = os.path.join(dist_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Prism API running"}
