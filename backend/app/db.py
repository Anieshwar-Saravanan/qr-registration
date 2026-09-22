"""Single shared Mongo client.

The client is created once at startup and reused for every request. Opening a
connection per request would mean a fresh TLS handshake to Atlas each time,
which is the first thing that falls over under load.
"""

import certifi
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

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


async def _drop_stale_index(collection: AsyncCollection, name: str) -> None:
    """Drop an index left over from an earlier schema.

    Indexes outlive the documents they indexed, so one dropped from the code
    stays in Atlas until something removes it. A stale unique index keeps
    enforcing a rule the application no longer has.
    """
    try:
        await collection.drop_index(name)
    except OperationFailure:
        # IndexNotFound: already gone, which is the normal case after the
        # first startup on a given cluster.
        pass


async def _ensure_indexes(db: AsyncDatabase) -> None:
    # The roll number is the natural identity of an attendee; user_id is what
    # the QR carries and what gets looked up on every scan. Email used to be
    # the unique key and is now an ordinary optional field, so its old unique
    # index has to go or a second person with no email would be rejected.
    await _drop_stale_index(db.users, "email_1")
    await db.users.create_index("roll_no", unique=True)
    await db.users.create_index("user_id", unique=True)

    await db.events.create_index("event_id", unique=True)

    # The compound unique index is the whole defence against double
    # registration. Two volunteers scanning the same badge at the same moment,
    # or one badge scanned twice, are both settled here by the database
    # rejecting the second write. An application-level "check then insert"
    # would have a race window that a busy door would find within minutes.
    await db.registrations.create_index(
        [("event_id", 1), ("user_id", 1)], unique=True, name="uniq_event_user"
    )
    # Listing a single event's registrations, newest first.
    await db.registrations.create_index([("event_id", 1), ("registered_at", -1)])
