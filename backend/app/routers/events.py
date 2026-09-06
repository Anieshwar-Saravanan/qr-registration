"""Events, scanning and registrations."""

import csv
import io
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.db import get_db
from app.models import (
    EventCreate,
    EventOut,
    EventStats,
    EventUpdate,
    ManualRegister,
    RegistrationPage,
    RemoveRegistrations,
    WinnerOut,
    WinnersUpdate,
    ScanRequest,
    ScanResult,
    SyncRequest,
    SyncResult,
    to_event_out,
    to_winner_out,
    to_registration_out,
)
from app.qr import InvalidPayload, parse_payload
from app.registration import register_user

router = APIRouter(prefix="/api/events", tags=["events"])


async def _find_event_or_404(event_id: str) -> dict:
    event = await get_db().events.find_one({"event_id": event_id})
    if event is None:
        raise HTTPException(status_code=404, detail=f"No event with id {event_id}")
    return event


# --------------------------------------------------------------------------
# Event CRUD
# --------------------------------------------------------------------------

@router.post("", response_model=EventOut, status_code=201)
async def create_event(payload: EventCreate) -> EventOut:
    doc = {
        "event_id": str(uuid.uuid4()),
        "status": "open",
        "created_at": datetime.now(timezone.utc),
        **payload.model_dump(),
    }
    await get_db().events.insert_one(doc)
    return to_event_out(doc, 0)


@router.get("", response_model=list[EventOut])
async def list_events() -> list[EventOut]:
    db = get_db()
    events = [doc async for doc in db.events.find().sort("created_at", -1)]
    if not events:
        return []

    # One grouped count for every event, rather than a query per event.
    counts = {
        row["_id"]: row["n"]
        async for row in await db.registrations.aggregate(
            [
                {"$match": {"event_id": {"$in": [e["event_id"] for e in events]}}},
                {"$group": {"_id": "$event_id", "n": {"$sum": 1}}},
            ]
        )
    }
    return [to_event_out(e, counts.get(e["event_id"], 0)) for e in events]


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: str) -> EventOut:
    event = await _find_event_or_404(event_id)
    count = await get_db().registrations.count_documents({"event_id": event_id})
    return to_event_out(event, count)


@router.patch("/{event_id}", response_model=EventOut)
async def update_event(event_id: str, payload: EventUpdate) -> EventOut:
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update.")

    updated = await get_db().events.find_one_and_update(
        {"event_id": event_id}, {"$set": changes}, return_document=True
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"No event with id {event_id}")

    count = await get_db().registrations.count_documents({"event_id": event_id})
    return to_event_out(updated, count)


# --------------------------------------------------------------------------
# Winners
# --------------------------------------------------------------------------

@router.get("/{event_id}/winners", response_model=list[WinnerOut])
async def list_winners(event_id: str) -> list[WinnerOut]:
    event = await _find_event_or_404(event_id)
    return [to_winner_out(w) for w in sorted(event.get("winners", []), key=lambda w: w["position"])]


@router.put("/{event_id}/winners", response_model=list[WinnerOut])
async def set_winners(event_id: str, payload: WinnersUpdate) -> list[WinnerOut]:
    """Replace the event's winners.

    The whole list is sent at once rather than one placing at a time, so
    reordering never leaves two people briefly holding the same position.
    """
    await _find_event_or_404(event_id)

    positions = [w.position for w in payload.winners]
    if len(set(positions)) != len(positions):
        raise HTTPException(status_code=400, detail="Two winners cannot share a position.")

    ids = [w.user_id for w in payload.winners]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="The same person cannot win twice.")

    users = {
        doc["user_id"]: doc
        async for doc in get_db().users.find({"user_id": {"$in": ids}})
    }
    missing = [uid for uid in ids if uid not in users]
    if missing:
        raise HTTPException(status_code=404, detail=f"{len(missing)} of those attendees no longer exist.")

    # Names are snapshotted alongside the id, so a results image stays true to
    # what was announced even if an attendee record is edited afterwards.
    entries = sorted(
        (
            {
                "position": w.position,
                "user_id": w.user_id,
                "name": users[w.user_id]["name"],
                "email": users[w.user_id]["email"],
                "phone": users[w.user_id].get("phone"),
                "organization": users[w.user_id].get("organization"),
            }
            for w in payload.winners
        ),
        key=lambda w: w["position"],
    )

    await get_db().events.update_one({"event_id": event_id}, {"$set": {"winners": entries}})
    return [to_winner_out(w) for w in entries]


# --------------------------------------------------------------------------
# Scanning
# --------------------------------------------------------------------------

async def _process_scan(event: dict, scan: ScanRequest) -> ScanResult:
    """Turn one raw scanned string into a registration outcome."""
    db = get_db()

    try:
        user_id = parse_payload(scan.payload)
    except InvalidPayload as e:
        return ScanResult(status="invalid_qr", message=str(e), scan_id=scan.scan_id)

    # The database is the source of truth, not the data printed in the badge.
    user = await db.users.find_one({"user_id": user_id})
    if user is None:
        return ScanResult(
            status="unknown_user",
            message="This badge is not in the attendee list.",
            scan_id=scan.scan_id,
        )

    return await register_user(
        db,
        event,
        user,
        method="scan",
        device_id=scan.device_id,
        scanned_at=scan.scanned_at,
        scan_id=scan.scan_id,
    )


@router.post("/{event_id}/scan", response_model=ScanResult)
async def scan(event_id: str, payload: ScanRequest) -> ScanResult:
    """Register whoever the scanned badge identifies."""
    event = await _find_event_or_404(event_id)
    return await _process_scan(event, payload)


@router.post("/{event_id}/scan/sync", response_model=SyncResult)
async def sync_scans(event_id: str, payload: SyncRequest) -> SyncResult:
    """Replay a batch of scans queued while a device was offline.

    Each scan is processed independently and reported on individually - one bad
    badge in a batch of 200 must not cost the other 199.
    """
    event = await _find_event_or_404(event_id)

    results = [await _process_scan(event, scan) for scan in payload.scans]

    summary: dict[str, int] = {}
    for r in results:
        summary[r.status] = summary.get(r.status, 0) + 1

    return SyncResult(results=results, summary=summary)


@router.post("/{event_id}/register", response_model=ScanResult)
async def manual_register(event_id: str, payload: ManualRegister) -> ScanResult:
    """Register someone chosen by name - the fallback when a badge will not scan."""
    event = await _find_event_or_404(event_id)

    user = await get_db().users.find_one({"user_id": payload.user_id})
    if user is None:
        raise HTTPException(status_code=404, detail="No such attendee.")

    return await register_user(
        get_db(), event, user, method="manual", device_id=payload.device_id
    )


@router.delete("/{event_id}/registrations/{user_id}", status_code=204)
async def undo_registration(event_id: str, user_id: str) -> Response:
    """Undo a mis-scan. Someone will scan the wrong person; this fixes it."""
    result = await get_db().registrations.delete_one(
        {"event_id": event_id, "user_id": user_id}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="That person is not registered.")
    return Response(status_code=204)


@router.post("/{event_id}/registrations/remove")
async def remove_registrations(event_id: str, payload: RemoveRegistrations) -> dict:
    """Un-register several attendees at once.

    A POST rather than DELETE because the list travels in a body, and one
    round trip rather than one per person when clearing a batch.
    """
    await _find_event_or_404(event_id)
    result = await get_db().registrations.delete_many(
        {"event_id": event_id, "user_id": {"$in": payload.user_ids}}
    )
    return {"removed": result.deleted_count, "requested": len(payload.user_ids)}


# --------------------------------------------------------------------------
# Registrations
# --------------------------------------------------------------------------

def _registration_filter(event_id: str, q: str | None) -> dict:
    query: dict = {"event_id": event_id}
    if q and q.strip():
        pattern = re.escape(q.strip())
        query["$or"] = [
            {"user_snapshot.name": {"$regex": pattern, "$options": "i"}},
            {"user_snapshot.email": {"$regex": pattern, "$options": "i"}},
            {"user_snapshot.organization": {"$regex": pattern, "$options": "i"}},
        ]
    return query


@router.get("/{event_id}/registrations", response_model=RegistrationPage)
async def list_registrations(
    event_id: str,
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> RegistrationPage:
    await _find_event_or_404(event_id)
    db = get_db()
    query = _registration_filter(event_id, q)

    total = await db.registrations.count_documents(query)
    cursor = db.registrations.find(query).sort("registered_at", -1).skip(offset).limit(limit)

    return RegistrationPage(
        items=[to_registration_out(doc) async for doc in cursor],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{event_id}/stats", response_model=EventStats)
async def event_stats(event_id: str) -> EventStats:
    event = await _find_event_or_404(event_id)
    db = get_db()

    by_method: dict[str, int] = {}
    async for row in await db.registrations.aggregate(
        [{"$match": {"event_id": event_id}}, {"$group": {"_id": "$method", "n": {"$sum": 1}}}]
    ):
        by_method[row["_id"] or "scan"] = row["n"]

    latest = await db.registrations.find_one(
        {"event_id": event_id}, sort=[("registered_at", -1)]
    )

    return EventStats(
        event_id=event_id,
        registered=sum(by_method.values()),
        total_attendees=await db.users.count_documents({}),
        capacity=event.get("capacity"),
        by_method=by_method,
        last_registration_at=latest["registered_at"] if latest else None,
    )


@router.get("/{event_id}/registrations/export.csv")
async def export_registrations(event_id: str, q: str | None = Query(default=None)):
    """Registrations as CSV, for whatever happens after the event."""
    event = await _find_event_or_404(event_id)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["Name", "Email", "Phone", "Organization", "Registered At", "Method", "Device"]
    )

    count = 0
    cursor = get_db().registrations.find(_registration_filter(event_id, q)).sort(
        "registered_at", 1
    )
    async for doc in cursor:
        r = to_registration_out(doc)
        writer.writerow(
            [
                r.name,
                r.email,
                r.phone or "",
                r.organization or "",
                r.registered_at.isoformat(timespec="seconds"),
                r.method,
                r.device_id or "",
            ]
        )
        count += 1

    slug = re.sub(r"[^a-zA-Z0-9]+", "-", event["name"]).strip("-").lower() or "event"
    return Response(
        # utf-8-sig: Excel misreads plain UTF-8 CSVs and mangles accented names.
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{slug}-registrations.csv"',
            "X-Row-Count": str(count),
        },
    )
