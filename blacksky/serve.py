"""BLACKSKY COMMAND local server: serves the static site (blacksky/site) at / and mounts the existing Grid Doomsday Finder API, unchanged,
at /api, so the site and the optional Python engines share one origin and no CORS or credentials are involved.

    PYTHONPATH=. uvicorn blacksky.serve:app --port 8010        (or: make blacksky-serve)

The original application (doomsday/api/app.py, app/) is imported, not modified; it keeps serving its own front end at
http://localhost:8000/ through `make serve`. Environment: BLACKSKY_SITE_DIR overrides the static directory (default blacksky/site);
GDF_APP_DIR / GDF_DATA_DIR are read by the original API exactly as before.
"""
from __future__ import annotations
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from doomsday.api.app import app as gdf_api

SITE_DIR = Path(os.environ.get("BLACKSKY_SITE_DIR", Path(__file__).resolve().parent / "site"))

app = FastAPI(title="BLACKSKY COMMAND", description="Static BLACKSKY site at /, Grid Doomsday Finder API at /api (unchanged).", docs_url=None, redoc_url=None)
app.mount("/api", gdf_api, name="gdf-api")
app.mount("/", StaticFiles(directory=str(SITE_DIR), html=True), name="blacksky")
