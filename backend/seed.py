"""Insert a few sample attendees so there is something to generate QRs for.

Nothing runs this automatically - it is only ever invoked by hand.

Run:  uv run python seed.py
"""

import asyncio
import uuid
from datetime import datetime, timezone

from app.db import connect, disconnect, get_db

SAMPLE_USERS = [
    {"name": "Aarav Menon", "roll_no": "9A01", "prodigy_id": 1,
     "school": "DAV Public School", "standard": 9,
     "phone": "9840011223", "email": "aarav.menon@example.com"},
    {"name": "Priya Raghavan", "roll_no": "10B14", "prodigy_id": 2,
     "school": "DAV Public School", "standard": 10,
     "phone": "9962044556", "email": "priya.raghavan@example.com"},
    {"name": "Daniel Osei", "roll_no": "11C07", "prodigy_id": 3,
     "school": "St. Xavier's Higher Secondary", "standard": 11,
     "phone": "9840550142", "email": "daniel.osei@example.com"},
    {"name": "Mei Tanaka", "roll_no": "12A22", "prodigy_id": 4,
     "school": "St. Xavier's Higher Secondary", "standard": 12,
     "phone": "9012345678", "email": "mei.tanaka@example.com"},
    # Only the two required fields, to exercise the optional-everything case.
    {"name": "Sofia Almeida", "roll_no": "9B33", "prodigy_id": None,
     "school": None, "standard": None, "phone": None, "email": None},
]


async def main() -> None:
    await connect()
    users = get_db().users

    inserted = skipped = 0
    for entry in SAMPLE_USERS:
        # The roll number is the identity, so that is what "already present"
        # means here - matching the unique index the insert would hit.
        if await users.find_one({"roll_no": entry["roll_no"]}):
            skipped += 1
            continue
        await users.insert_one({
            "user_id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc),
            **entry,
        })
        inserted += 1

    print(f"Seed complete: {inserted} inserted, {skipped} already present.")
    print(f"Total users in collection: {await users.count_documents({})}")
    await disconnect()


if __name__ == "__main__":
    asyncio.run(main())
