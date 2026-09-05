"""Core registration logic, shared by live scans, offline sync and manual adds.

Kept out of the router so all three entry points behave identically - a scan
replayed from an offline queue must produce exactly the same result as one made
live, or the two paths drift apart.
"""

import uuid
from datetime import datetime, timedelta, timezone

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.models import ScanResult, to_user_out

# A device claiming to have scanned in the future has a wrong clock. Small
# amounts are normal phone drift.
FUTURE_TOLERANCE = timedelta(minutes=5)
# A scan queued offline is legitimately hours old by the time it syncs, so
# past-dated scans are expected and must NOT be treated as clock skew. Only
# something absurdly old suggests a genuinely broken clock.
PAST_TOLERANCE = timedelta(days=7)


def _resolve_scan_time(scanned_at: datetime | None) -> tuple[datetime, int | None]:
    """Decide what time to record, and flag an implausible device clock.

    Returns (registered_at, clock_skew_seconds). The device's own timestamp is
    trusted by default - it is the only record of when the person actually
    walked in - but is replaced by server time when it is impossible.
    """
    now = datetime.now(timezone.utc)
    if scanned_at is None:
        return now, None

    # A naive datetime from a client is treated as UTC rather than rejected.
    if scanned_at.tzinfo is None:
        scanned_at = scanned_at.replace(tzinfo=timezone.utc)

    delta = scanned_at - now
    if delta > FUTURE_TOLERANCE or -delta > PAST_TOLERANCE:
        return now, int(delta.total_seconds())

    return scanned_at, None


async def register_user(
    db: AsyncDatabase,
    event: dict,
    user: dict,
    *,
    method: str = "scan",
    device_id: str | None = None,
    scanned_at: datetime | None = None,
    scan_id: str | None = None,
) -> ScanResult:
    """Register `user` for `event`, idempotently."""
    if event.get("status") == "closed":
        return ScanResult(
            status="event_closed",
            message=f"“{event['name']}” is closed to new registrations.",
            user=to_user_out(user),
            scan_id=scan_id,
        )

    capacity = event.get("capacity")
    if capacity is not None:
        # Read-then-write, so two simultaneous scans could in principle both
        # pass at the exact boundary. Deliberate: a hard guarantee would need
        # a transaction on every scan, and being one over capacity matters far
        # less at a door than a slow scanner does.
        current = await db.registrations.count_documents({"event_id": event["event_id"]})
        if current >= capacity:
            return ScanResult(
                status="event_full",
                message=f"“{event['name']}” is full ({capacity} registered).",
                user=to_user_out(user),
                scan_id=scan_id,
            )

    registered_at, skew = _resolve_scan_time(scanned_at)

    doc = {
        "registration_id": str(uuid.uuid4()),
        "event_id": event["event_id"],
        "user_id": user["user_id"],
        # Snapshot so the registration records who walked in as they were, and
        # so exports need no join back to the users collection.
        "user_snapshot": {
            "name": user["name"],
            "email": user["email"],
            "phone": user.get("phone"),
            "organization": user.get("organization"),
        },
        "registered_at": registered_at,
        "received_at": datetime.now(timezone.utc),
        "method": method,
        "device_id": device_id,
        "scan_id": scan_id,
    }
    if skew is not None:
        doc["clock_skew_seconds"] = skew

    try:
        await db.registrations.insert_one(doc)
    except DuplicateKeyError:
        # The unique (event_id, user_id) index fired: this person is already
        # registered. That is a normal outcome at a door, not an error.
        existing = await db.registrations.find_one(
            {"event_id": event["event_id"], "user_id": user["user_id"]}
        )
        when = existing["registered_at"] if existing else None
        return ScanResult(
            status="already_registered",
            message=f"{user['name']} is already registered"
            + (f" (at {when:%H:%M})" if when else "")
            + ".",
            user=to_user_out(user),
            registered_at=when,
            scan_id=scan_id,
        )

    return ScanResult(
        status="registered",
        message=f"{user['name']} registered.",
        user=to_user_out(user),
        registered_at=registered_at,
        scan_id=scan_id,
    )
