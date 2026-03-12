from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from routers import ingest, query, profile, projects, schema

app = FastAPI(title="Prism — AI Data Workspace", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router,   prefix="/api", tags=["ingest"])
app.include_router(query.router,    prefix="/api", tags=["query"])
app.include_router(profile.router,  prefix="/api", tags=["profile"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(schema.router,   prefix="/api", tags=["schema"])

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
async def root():
    index_path = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Prism API running"}

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
