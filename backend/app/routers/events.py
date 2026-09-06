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
    TeamCreate,
    TeamOut,
    WinnerOut,
    WinnersUpdate,
    ScanRequest,
    ScanResult,
    SyncRequest,
    SyncResult,
    to_event_out,
    to_winner_out,
    to_registration_out,
    to_team_out,
)
from app.qr import InvalidPayload, parse_payload
from app.registration import register_user
from app.teams import TeamError, create_team

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


async def _counts_by_event(collection, event_ids: list[str]) -> dict[str, int]:
    """One grouped count for every event, rather than a query per event."""
    return {
        row["_id"]: row["n"]
        async for row in await collection.aggregate(
            [
                {"$match": {"event_id": {"$in": event_ids}}},
                {"$group": {"_id": "$event_id", "n": {"$sum": 1}}},
            ]
        )
    }


@router.get("", response_model=list[EventOut])
async def list_events() -> list[EventOut]:
    db = get_db()
    events = [doc async for doc in db.events.find().sort("created_at", -1)]
    if not events:
        return []

    ids = [e["event_id"] for e in events]
    regs = await _counts_by_event(db.registrations, ids)
    teams = await _counts_by_event(db.teams, ids)
    return [
        to_event_out(e, regs.get(e["event_id"], 0), teams.get(e["event_id"], 0))
        for e in events
    ]


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: str) -> EventOut:
    event = await _find_event_or_404(event_id)
    db = get_db()
    return to_event_out(
        event,
        await db.registrations.count_documents({"event_id": event_id}),
        await db.teams.count_documents({"event_id": event_id}),
    )


@router.patch("/{event_id}", response_model=EventOut)
async def update_event(event_id: str, payload: EventUpdate) -> EventOut:
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update.")

    # Switching to a team event needs sizes, from this update or already
    # stored - otherwise the scanner has no bounds to enforce.
    existing = await _find_event_or_404(event_id)
    merged = {**existing, **changes}
    if merged.get("event_type") == "team":
        lo, hi = merged.get("team_size_min"), merged.get("team_size_max")
        if lo is None or hi is None:
            raise HTTPException(
                status_code=400,
                detail="A team event needs a minimum and maximum team size.",
            )
        if lo > hi:
            raise HTTPException(
                status_code=400, detail="Minimum team size cannot exceed the maximum."
            )

    # Turning a team event back into an individual one would strand its teams:
    # the rows stay in the database with nothing left to display them. Better
    # to say so than to silently orphan them.
    if merged.get("event_type") == "individual" and existing.get("event_type") == "team":
        team_count = await get_db().teams.count_documents({"event_id": event_id})
        if team_count:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"This event has {team_count} team{'s' if team_count != 1 else ''}. "
                    "Disband them before making it an individual event."
                ),
            )

    # An individual event has no team sizes to remember; leaving them set would
    # resurrect stale bounds if it were switched back later.
    if merged.get("event_type") == "individual":
        changes["team_size_min"] = None
        changes["team_size_max"] = None

    # Winners belong to one kind of event: a team placing makes no sense once
    # the event is individual, and vice versa. Clearing them here is better
    # than leaving placings that can be displayed but never saved again.
    if merged.get("event_type") != existing.get("event_type", "individual"):
        changes["winners"] = []

    updated = await get_db().events.find_one_and_update(
        {"event_id": event_id}, {"$set": changes}, return_document=True
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"No event with id {event_id}")

    db = get_db()
    return to_event_out(
        updated,
        await db.registrations.count_documents({"event_id": event_id}),
        await db.teams.count_documents({"event_id": event_id}),
    )


@router.delete("/{event_id}", status_code=200)
async def delete_event(
    event_id: str,
    force: bool = Query(
        False,
        description="Required to delete an event that still has registrations or teams.",
    ),
) -> dict:
    """Delete an event along with its registrations and teams.

    Deleting is refused without `force` once anything is attached to the event,
    so a misplaced click cannot wipe a day's scanning. The refusal reports the
    counts, which is what the confirmation dialog shows back to the organiser.

    Attendees themselves are never touched: they belong to the attendee list,
    not to the event, and their badges stay valid for other events.
    """
    await _find_event_or_404(event_id)
    db = get_db()

    registrations = await db.registrations.count_documents({"event_id": event_id})
    teams = await db.teams.count_documents({"event_id": event_id})

    if (registrations or teams) and not force:
        parts = []
        if registrations:
            parts.append(f"{registrations} registration{'s' if registrations != 1 else ''}")
        if teams:
            parts.append(f"{teams} team{'s' if teams != 1 else ''}")
        raise HTTPException(
            status_code=409,
            detail=f"This event still has {' and '.join(parts)}.",
        )

    # Registrations and teams first: an event that vanished mid-delete leaving
    # its rows behind would be invisible and unreachable.
    await db.registrations.delete_many({"event_id": event_id})
    await db.teams.delete_many({"event_id": event_id})
    await db.events.delete_one({"event_id": event_id})

    return {"deleted": True, "registrations_removed": registrations, "teams_removed": teams}


# --------------------------------------------------------------------------
# Teams
# --------------------------------------------------------------------------

@router.get("/{event_id}/teams", response_model=list[TeamOut])
async def list_teams(event_id: str) -> list[TeamOut]:
    await _find_event_or_404(event_id)
    cursor = get_db().teams.find({"event_id": event_id}).sort("created_at", 1)
    return [to_team_out(doc) async for doc in cursor]


@router.post("/{event_id}/teams", response_model=TeamOut, status_code=201)
async def create_event_team(event_id: str, payload: TeamCreate) -> TeamOut:
    """Create a team and register all of its members in one step."""
    event = await _find_event_or_404(event_id)
    try:
        team = await create_team(
            get_db(),
            event,
            name=payload.name,
            member_ids=payload.member_ids,
            device_id=payload.device_id,
            created_at=payload.created_at,
        )
    except TeamError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    return to_team_out(team)


@router.delete("/{event_id}/teams/{team_id}", status_code=204)
async def disband_team(event_id: str, team_id: str) -> Response:
    """Remove a team and un-register its members from the event."""
    result = await get_db().teams.delete_one({"event_id": event_id, "team_id": team_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No such team for this event.")
    # Members lose their registration with the team: they were only registered
    # as part of it, so leaving them behind would strand them team-less.
    await get_db().registrations.delete_many({"event_id": event_id, "team_id": team_id})
    return Response(status_code=204)


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
    event = await _find_event_or_404(event_id)
    is_team_event = event.get("event_type") == "team"

    positions = [w.position for w in payload.winners]
    if len(set(positions)) != len(positions):
        raise HTTPException(status_code=400, detail="Two winners cannot share a position.")

    # A placing must match the event: a team event is won by teams, an
    # individual event by people. Mixing them would leave the results image
    # with rows it cannot render.
    wrong = [w for w in payload.winners if bool(w.team_id) != is_team_event]
    if wrong:
        raise HTTPException(
            status_code=400,
            detail=(
                "This is a team event — winners must be teams."
                if is_team_event
                else "This is an individual event — winners must be attendees."
            ),
        )

    if is_team_event:
        entries = await _team_winner_entries(event, payload)
    else:
        entries = await _user_winner_entries(payload)

    await get_db().events.update_one({"event_id": event_id}, {"$set": {"winners": entries}})
    return [to_winner_out(w) for w in entries]


async def _user_winner_entries(payload: WinnersUpdate) -> list[dict]:
    ids = [w.user_id for w in payload.winners]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="The same person cannot win twice.")

    users = {
        doc["user_id"]: doc
        async for doc in get_db().users.find({"user_id": {"$in": ids}})
    }
    missing = [uid for uid in ids if uid not in users]
    if missing:
        raise HTTPException(
            status_code=404, detail=f"{len(missing)} of those attendees no longer exist."
        )

    # Names are snapshotted alongside the id, so a results image stays true to
    # what was announced even if an attendee record is edited afterwards.
    return sorted(
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


async def _team_winner_entries(event: dict, payload: WinnersUpdate) -> list[dict]:
    ids = [w.team_id for w in payload.winners]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="The same team cannot win twice.")

    teams = {
        doc["team_id"]: doc
        async for doc in get_db().teams.find(
            {"event_id": event["event_id"], "team_id": {"$in": ids}}
        )
    }
    # A team that was disbanded after being announced keeps its placing: the
    # snapshot already on the event stands in for the deleted team, so
    # reordering the rest does not drop the row from the results image.
    snapshots = {
        w["team_id"]: w for w in event.get("winners", []) if w.get("team_id")
    }
    missing = [tid for tid in ids if tid not in teams and tid not in snapshots]
    if missing:
        raise HTTPException(
            status_code=404, detail=f"{len(missing)} of those teams no longer exist."
        )

    def snapshot(team_id: str) -> dict:
        source = teams.get(team_id) or snapshots[team_id]
        # The full member list is snapshotted too, not just the team name: the
        # results image shows every member.
        return {
            "team_id": team_id,
            "name": source["name"],
            "members": [
                {
                    "user_id": m["user_id"],
                    "name": m.get("name", "(unknown)"),
                    "email": m.get("email", ""),
                    "phone": m.get("phone"),
                    "organization": m.get("organization"),
                }
                for m in source.get("members", [])
            ],
        }

    return sorted(
        ({"position": w.position, **snapshot(w.team_id)} for w in payload.winners),
        key=lambda w: w["position"],
    )


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
        ["Name", "Email", "Phone", "Organization", "Team", "Registered At", "Method", "Device"]
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
                r.team_name or "",
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
