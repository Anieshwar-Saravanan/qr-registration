"""Add team-registration fields to existing events and registrations.

Purely additive: every event becomes `individual`, which is exactly how they
behave today, so nothing changes until an event is explicitly switched to
`team`. Run with --apply to write; without it, reports what would change.
"""

import asyncio
import sys

from app.db import connect, disconnect, get_db

APPLY = "--apply" in sys.argv


async def main() -> None:
    await connect()
    db = get_db()

    events_needing = await db.events.count_documents({"event_type": {"$exists": False}})
    regs_needing = await db.registrations.count_documents({"team_id": {"$exists": False}})

    print(f"events without event_type   : {events_needing}")
    print(f"registrations without team_id: {regs_needing}")

    if not APPLY:
        print("\nDry run. Nothing written. Re-run with --apply to migrate.")
        async for e in db.events.find({}, {"name": 1, "event_type": 1, "_id": 0}):
            print(f"   {e['name']:20} -> event_type={e.get('event_type', 'individual (would be set)')}")
        await disconnect()
        return

    ev = await db.events.update_many(
        {"event_type": {"$exists": False}},
        {"$set": {"event_type": "individual", "team_size_min": None, "team_size_max": None}},
    )
    # team_id is null for an individual registration; making it explicit keeps
    # every registration the same shape whichever kind of event it belongs to.
    rg = await db.registrations.update_many(
        {"team_id": {"$exists": False}},
        {"$set": {"team_id": None, "team_name": None}},
    )
    print(f"\nupdated {ev.modified_count} events, {rg.modified_count} registrations")

    # Teams are unique per event by name, and looked up per event when scanning.
    await db.teams.create_index([("event_id", 1), ("name", 1)], unique=True, name="uniq_event_team_name")
    await db.teams.create_index("team_id", unique=True)
    await db.registrations.create_index([("event_id", 1), ("team_id", 1)])
    print("team indexes created")

    async for e in db.events.find({}, {"name": 1, "event_type": 1, "_id": 0}):
        print(f"   {e['name']:20} {e['event_type']}")

    await disconnect()


if __name__ == "__main__":
    asyncio.run(main())
