"""Local-only dev server: serves the frontend + chatbot API from one process
on one origin, so frontend/js/chat.js's relative "/api" calls just work with
no CORS setup needed. Not used in AWS -- there, Lambda only exposes the API
(main.py's `handler`) and S3/CloudFront serve the frontend separately.

Run from backend/: python -m app.local_dev
"""
import pathlib

import uvicorn
from fastapi.staticfiles import StaticFiles

from .main import app

FRONTEND_DIR = pathlib.Path(__file__).resolve().parents[2] / "frontend"

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
