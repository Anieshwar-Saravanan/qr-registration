"""Settings loaded from the project-root .env."""

import os
from pathlib import Path

from dotenv import load_dotenv

# .env lives at the repo root, one level above backend/
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "qr_registration")

# Vite's dev server; extend when the frontend gets deployed.
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if not MONGO_URL:
    raise RuntimeError(f"MONGO_URL is not set. Expected it in {ROOT / '.env'}")
