"""Single shared Mongo client.

The client is created once at startup and reused for every request. Opening a
connection per request would mean a fresh TLS handshake to Atlas each time,
which is the first thing that falls over under load.
"""

import certifi
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.config import DB_NAME, MONGO_URL
from app.schools import build_prodigy_id, serial_of

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


def _counter_key(school_id: int, standard: int) -> str:
    return f"pid:{school_id:02d}:{standard}"


async def _highest_serial(db: AsyncDatabase, school_id: int, standard: int) -> int:
    """The largest serial already used by this school+class, or 0."""
    top = await db.users.find_one(
        {"school_id": school_id, "standard": standard, "prodigy_id": {"$type": "number"}},
        sort=[("prodigy_id", -1)],
    )
    return serial_of(top["prodigy_id"]) if top else 0


async def claim_prodigy_ids(
    db: AsyncDatabase, school_id: int, standard: int, count: int = 1
) -> list[int]:
    """Reserve `count` Prodigy IDs for one school and class.

    The serial counts within a school+class pair, so each class at each school
    starts again at 001. A single atomic `$inc` rather than "read the highest,
    add one": two operators adding a student at the same moment would both
    read the same highest value and both try to use it. One round trip for a
    whole import, too, instead of one per row.
    """
    key = _counter_key(school_id, standard)
    if await db.counters.find_one({"_id": key}) is None:
        # First id for this pair on this deployment. Start above anything
        # already stored - a restored backup, or ids typed by hand before
        # auto-assignment existed.
        await db.counters.update_one(
            {"_id": key},
            {"$max": {"seq": await _highest_serial(db, school_id, standard)}},
            upsert=True,
        )

    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": count}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    end = doc["seq"]
    return [
        build_prodigy_id(school_id, standard, serial)
        for serial in range(end - count + 1, end + 1)
    ]


async def reserve_prodigy_id(
    db: AsyncDatabase, school_id: int, standard: int, prodigy_id: int
) -> None:
    """Push a school+class counter up past a hand-typed id.

    Without this, typing 029500 by hand and then letting the next student in
    that class be auto-assigned would hand out 001, 002... until it collided
    with 500 and the unique index rejected a perfectly ordinary save.
    """
    await db.counters.update_one(
        {"_id": _counter_key(school_id, standard)},
        {"$max": {"seq": serial_of(prodigy_id)}},
        upsert=True,
    )


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
    # Both partial, so the uniqueness only applies to students who actually
    # have the field. A plain unique index treats every missing value as the
    # same one and would reject the second student left without one.
    await _drop_stale_index(db.users, "roll_no_1")
    await db.users.create_index(
        "roll_no",
        unique=True,
        name="uniq_roll_no",
        partialFilterExpression={"roll_no": {"$type": "string"}},
    )
    await db.users.create_index(
        "prodigy_id",
        unique=True,
        name="uniq_prodigy_id",
        partialFilterExpression={"prodigy_id": {"$type": "number"}},
    )
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
