"""
Main FastAPI Application Entrypoint.
"""

import os
import sys
from pathlib import Path

# Add root directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import CORS_ORIGINS, API_HOST, API_PORT
from backend.routers import backtest, deals, stocks, system, conviction, screener, symbol_matcher as symbol_matcher_router, alerts
from backend.engine.symbol_matcher import matcher
from backend.engine.conviction import persistence as conviction_persistence

app = FastAPI(
    title="NiftyFirst Insider Backtesting API",
    description="Quantitative backtesting and analysis API for Insider Trading and Large Market Deals",
    version="1.0.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(backtest.router)
app.include_router(deals.router)
app.include_router(stocks.router)
app.include_router(system.router)
app.include_router(conviction.router)
app.include_router(screener.router)
app.include_router(symbol_matcher_router.router)
app.include_router(alerts.router)


@app.on_event("startup")
def startup_event():
    """Initializes symbol matcher, conviction engine, and alerts schema on server startup."""
    try:
        matcher.initialize()
    except Exception:
        pass
    try:
        conviction_persistence.ensure_schema()
    except Exception:
        pass
    try:
        alerts.ensure_schema()
    except Exception:
        pass


@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": "NiftyFirst Insider Backtesting Engine"}


# Mount static production frontend build if present
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=API_HOST, port=API_PORT, reload=True)
