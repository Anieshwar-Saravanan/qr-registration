"""Insert a few sample attendees so there is something to generate QRs for.

Nothing runs this automatically - it is only ever invoked by hand.

Run:  uv run python seed.py
"""

import asyncio
import uuid
from datetime import datetime, timezone

from app.db import connect, disconnect, get_db

SAMPLE_USERS = [
    {"name": "Aarav Menon", "roll_no": "21CS001", "domain": "Web Development",
     "position": "Lead", "year": 4, "department": "CSE",
     "phone": "9840011223", "email": "aarav.menon@example.com"},
    {"name": "Priya Raghavan", "roll_no": "21EC018", "domain": "Artificial Intelligence",
     "position": "Member", "year": 4, "department": "ECE",
     "phone": "9962044556", "email": "priya.raghavan@example.com"},
    {"name": "Daniel Osei", "roll_no": "22IT042", "domain": "Cybersecurity",
     "position": "Coordinator", "year": 3, "department": "IT",
     "phone": "9840550142", "email": "daniel.osei@example.com"},
    {"name": "Mei Tanaka", "roll_no": "23ME107", "domain": "Robotics",
     "position": "Member", "year": 2, "department": "MECH",
     "phone": "9012345678", "email": "mei.tanaka@example.com"},
    # Only the two required fields, to exercise the optional-everything case.
    {"name": "Sofia Almeida", "roll_no": "24CS230", "domain": None,
     "position": None, "year": None, "department": None,
     "phone": None, "email": None},
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
