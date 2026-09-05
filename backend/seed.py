"""Insert a few sample attendees so there is something to generate QRs for.

Run:  uv run python seed.py
"""

import asyncio
import uuid
from datetime import datetime, timezone

from app.db import connect, disconnect, get_db

SAMPLE_USERS = [
    {"name": "Aarav Menon", "email": "aarav.menon@example.com",
     "phone": "+91 98400 11223", "organization": "Zoho"},
    {"name": "Priya Raghavan", "email": "priya.raghavan@example.com",
     "phone": "+91 99620 44556", "organization": "Freshworks"},
    {"name": "Daniel Osei", "email": "daniel.osei@example.com",
     "phone": "+1 415 555 0142", "organization": "Stripe"},
    {"name": "Mei Tanaka", "email": "mei.tanaka@example.com",
     "phone": "+81 90 1234 5678", "organization": "Rakuten"},
    {"name": "Sofia Almeida", "email": "sofia.almeida@example.com",
     "phone": None, "organization": "Independent"},
]


async def main() -> None:
    await connect()
    users = get_db().users

    inserted = skipped = 0
    for entry in SAMPLE_USERS:
        if await users.find_one({"email": entry["email"]}):
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
