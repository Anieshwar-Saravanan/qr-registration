"""Single shared Mongo client.

The client is created once at startup and reused for every request. Opening a
connection per request would mean a fresh TLS handshake to Atlas each time,
which is the first thing that falls over under load.
"""

import certifi
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.config import DB_NAME, MONGO_URL

_client: AsyncMongoClient | None = None


async def connect() -> None:
    global _client
    _client = AsyncMongoClient(MONGO_URL, tlsCAFile=certifi.where())
    await _client.admin.command("ping")
    await _ensure_indexes(_client[DB_NAME])


async def disconnect() -> None:
    if _client is not None:
        await _client.close()


def get_db() -> AsyncDatabase:
    if _client is None:
        raise RuntimeError("Database not connected. Did the app lifespan run?")
    return _client[DB_NAME]


async def _ensure_indexes(db: AsyncDatabase) -> None:
    # Email is the natural identity of an attendee; user_id is what the QR
    # carries and what Phase 2 will look up on every scan.
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
