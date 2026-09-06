"""Creating a team and registering all its members together.

Kept out of the router because the scanner, the offline sync path and manual
creation must all behave identically - a team formed at the door and one
replayed from a queue have to produce the same result.
"""

import uuid
from datetime import datetime, timezone

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import BulkWriteError, DuplicateKeyError

MAX_NAME_ATTEMPTS = 50


class TeamError(Exception):
    """A team cannot be created as asked. The message is shown to the operator."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


async def validate_members(db: AsyncDatabase, event: dict, member_ids: list[str]) -> list[dict]:
    """Check every member before anything is written.

    Validating up front matters at a door: discovering at commit that one of
    five people is already registered means the other four have queued for
    nothing. The scanner performs the same checks per scan so this rarely
    fires, but it is the authority.
    """
    if event.get("event_type") != "team":
        raise TeamError(f"“{event['name']}” is not a team event.")
    if event.get("status") == "closed":
        raise TeamError(f"“{event['name']}” is closed to new registrations.")

    lo = event.get("team_size_min") or 1
    hi = event.get("team_size_max") or len(member_ids)
    if len(member_ids) < lo:
        raise TeamError(f"A team needs at least {lo} members; this one has {len(member_ids)}.")
    if len(member_ids) > hi:
        raise TeamError(f"A team can have at most {hi} members; this one has {len(member_ids)}.")

    found = {doc["user_id"]: doc async for doc in db.users.find({"user_id": {"$in": member_ids}})}
    missing = [uid for uid in member_ids if uid not in found]
    if missing:
        raise TeamError(f"{len(missing)} scanned badge(s) are not in the attendee list.", 404)

    # Already registered for this event, individually or in another team.
    clashes = [
        doc
        async for doc in db.registrations.find(
            {"event_id": event["event_id"], "user_id": {"$in": member_ids}}
        )
    ]
    if clashes:
        names = []
        for c in clashes:
            who = c.get("user_snapshot", {}).get("name", "Someone")
            names.append(f"{who} (in {c['team_name']})" if c.get("team_name") else who)
        raise TeamError(
            f"Already registered for this event: {', '.join(names)}.", 409
        )

    # Preserve the order members were scanned in.
    return [found[uid] for uid in member_ids]


async def _insert_with_unique_name(db: AsyncDatabase, doc: dict) -> tuple[dict, str | None]:
    """Insert the team, suffixing the name if that name is already taken.

    Two devices working offline can both name a team "Alpha" and neither can
    know. Renaming the second on arrival is far better than rejecting a team
    whose members have already walked in and gone.
    """
    original = doc["name"]
    for attempt in range(1, MAX_NAME_ATTEMPTS + 1):
        try:
            await db.teams.insert_one(doc)
            return doc, (original if attempt > 1 else None)
        except DuplicateKeyError:
            doc = {**doc, "name": f"{original} ({attempt + 1})"}
    raise TeamError(f"Could not find a free name based on “{original}”.", 409)


async def create_team(
    db: AsyncDatabase,
    event: dict,
    *,
    name: str,
    member_ids: list[str],
    device_id: str | None = None,
    created_at: datetime | None = None,
) -> dict:
    """Validate, create the team, and register every member to the event."""
    users = await validate_members(db, event, member_ids)

    now = datetime.now(timezone.utc)
    when = created_at or now
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)

    team_id = str(uuid.uuid4())
    members = [
        {
            "user_id": u["user_id"],
            "name": u["name"],
            "email": u["email"],
            "phone": u.get("phone"),
            "organization": u.get("organization"),
        }
        for u in users
    ]

    team_doc = {
        "team_id": team_id,
        "event_id": event["event_id"],
        "name": name,
        "size": len(members),
        "members": members,
        "created_at": when,
        "received_at": now,
        "device_id": device_id,
    }
    team_doc, renamed_from = await _insert_with_unique_name(db, team_doc)
    if renamed_from:
        team_doc["renamed_from"] = renamed_from
        await db.teams.update_one({"team_id": team_id}, {"$set": {"renamed_from": renamed_from}})

    registrations = [
        {
            "registration_id": str(uuid.uuid4()),
            "event_id": event["event_id"],
            "user_id": m["user_id"],
            "user_snapshot": dict(m),
            "registered_at": when,
            "received_at": now,
            "method": "scan",
            "device_id": device_id,
            "team_id": team_id,
            "team_name": team_doc["name"],
        }
        for m in members
    ]

    try:
        await db.registrations.insert_many(registrations, ordered=False)
    except BulkWriteError as e:
        # Someone was registered between validation and here - a narrow race,
        # but a team half-registered is worse than none, so undo and report.
        await db.registrations.delete_many({"team_id": team_id})
        await db.teams.delete_one({"team_id": team_id})
        dupes = [w for w in e.details.get("writeErrors", []) if w.get("code") == 11000]
        clashed = [registrations[w["index"]]["user_snapshot"]["name"] for w in dupes if "index" in w]
        raise TeamError(
            "Someone was registered while this team was being saved: "
            f"{', '.join(clashed) or 'unknown'}. Nothing was saved; scan the team again.",
            409,
        )

    return team_doc
