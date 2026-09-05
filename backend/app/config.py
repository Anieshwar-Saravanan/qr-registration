"""Settings loaded from the project-root .env."""

import os
from pathlib import Path

from dotenv import load_dotenv

# .env lives at the repo root, one level above backend/
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "qr_registration")

# Vite's dev server, always allowed so local work needs no configuration.
_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://localhost:5173",
]

# Deployed frontends, as a comma-separated list:
#   CORS_ORIGINS=https://qr-registration.vercel.app,https://reg.myevent.com
CORS_ORIGINS = _DEV_ORIGINS + [
    o.strip().rstrip("/")
    for o in os.getenv("CORS_ORIGINS", "").split(",")
    if o.strip()
]

# Vercel gives every branch and pull request its own hostname
# (project-git-branch-user.vercel.app), so preview deployments cannot be listed
# ahead of time. Set ALLOW_VERCEL_PREVIEWS=1 to accept them by pattern.
CORS_ORIGIN_REGEX = (
    r"https://.*\.vercel\.app" if os.getenv("ALLOW_VERCEL_PREVIEWS") == "1" else None
)

if not MONGO_URL:
    raise RuntimeError(f"MONGO_URL is not set. Expected it in {ROOT / '.env'}")
