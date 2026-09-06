"""User CRUD, search, spreadsheet import and QR generation."""

import io
import re
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pymongo.errors import BulkWriteError, DuplicateKeyError

from app.db import get_db
from app.importer import parse_rows, read_table
from app.models import (
    BadgeRequest,
    BulkCreate,
    BulkResult,
    ImportPreview,
    UserCreate,
    UserOut,
    UserPage,
    to_user_out,
)
from app.pdf import PER_PAGE, build_badge_pdf
from app.qr import build_payload, render_data_uri, render_png

router = APIRouter(prefix="/api/users", tags=["users"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _slugify(name: str) -> str:
    """Filename-safe version of a name.

    NFKD decomposition turns "Zoe\u0308" into "Zoe" rather than dropping the
    letter entirely, so accented names keep their spelling in the filename.
    Names in non-Latin scripts reduce to nothing, hence the fallback - the
    user_id suffix still makes every filename unique.
    """
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", ascii_name).strip("-").lower() or "attendee"


def _search_filter(q: str | None) -> dict:
    """Case-insensitive substring match across name, email and organization.

    re.escape matters: without it a stray '(' in the query raises a regex
    error, and a pathological pattern could pin the server on a scan.
    """
    if not q or not q.strip():
        return {}
    pattern = re.escape(q.strip())
    return {
        "$or": [
            {"name": {"$regex": pattern, "$options": "i"}},
            {"email": {"$regex": pattern, "$options": "i"}},
            {"organization": {"$regex": pattern, "$options": "i"}},
        ]
    }


def _new_user_doc(payload: UserCreate) -> dict:
    return {
        "user_id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc),
        **payload.model_dump(),
    }


async def _find_user_or_404(user_id: str) -> dict:
    user = await get_db().users.find_one({"user_id": user_id})
    if user is None:
        raise HTTPException(status_code=404, detail=f"No user with id {user_id}")
    return user


# --------------------------------------------------------------------------
# CRUD + search
# --------------------------------------------------------------------------

@router.post("", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreate) -> UserOut:
    doc = _new_user_doc(payload)
    try:
        await get_db().users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409, detail=f"A user with email {payload.email} already exists"
        )
    return to_user_out(doc)


@router.get("", response_model=UserPage)
async def list_users(
    q: str | None = Query(default=None, max_length=120, description="Search name, email or organization"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> UserPage:
    users = get_db().users
    query = _search_filter(q)

    total = await users.count_documents(query)
    cursor = users.find(query).sort("created_at", -1).skip(offset).limit(limit)

    return UserPage(
        items=[to_user_out(doc) async for doc in cursor],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: str) -> UserOut:
    return to_user_out(await _find_user_or_404(user_id))


# --------------------------------------------------------------------------
# Spreadsheet import
# --------------------------------------------------------------------------

@router.post("/import/preview", response_model=ImportPreview)
async def preview_import(file: UploadFile = File(...)) -> ImportPreview:
    """Parse and validate an uploaded sheet WITHOUT writing anything.

    Split from the commit step so a bad column guess is caught by a human
    before it puts 300 malformed records into the database.
    """
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is {len(raw) // 1024}KB; the limit is {MAX_UPLOAD_BYTES // 1024}KB.",
        )
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    try:
        table = read_table(file.filename or "", raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    existing = {
        doc["email"] async for doc in get_db().users.find({}, {"email": 1, "_id": 0})
    }

    try:
        rows, mapping, unmapped = parse_rows(table, existing)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    summary = {"ok": 0, "invalid": 0, "duplicate_in_file": 0, "already_exists": 0}
    for row in rows:
        summary[row.status] += 1

    header = table[0]
    return ImportPreview(
        filename=file.filename or "upload",
        detected_columns=[str(h) for h in header if str(h).strip()],
        column_mapping={str(header[i]): field for i, field in mapping.items()},
        unmapped_columns=unmapped,
        rows=rows,
        summary=summary,
    )


@router.post("/bulk", response_model=BulkResult, status_code=201)
async def bulk_create(payload: BulkCreate) -> BulkResult:
    """Insert many users at once, skipping any whose email already exists."""
    docs = [_new_user_doc(u) for u in payload.users]

    try:
        # ordered=False: one duplicate must not abort the remaining inserts,
        # and it is a single round trip to Atlas rather than one per row.
        result = await get_db().users.insert_many(docs, ordered=False)
        return BulkResult(
            inserted=len(result.inserted_ids),
            skipped=0,
            skipped_emails=[],
            user_ids=[d["user_id"] for d in docs],
        )
    except BulkWriteError as e:
        dupes = [err for err in e.details.get("writeErrors", []) if err.get("code") == 11000]
        if len(dupes) != len(e.details.get("writeErrors", [])):
            raise HTTPException(status_code=500, detail="Bulk insert failed unexpectedly.")

        skipped_emails = [err.get("op", {}).get("email", "unknown") for err in dupes]
        # Everything the server did not reject went in; identify those by
        # position so the badge sheet covers exactly the new arrivals.
        failed_indexes = {err["index"] for err in dupes if "index" in err}
        inserted_ids = [
            d["user_id"] for i, d in enumerate(docs) if i not in failed_indexes
        ]
        return BulkResult(
            inserted=e.details.get("nInserted", 0),
            skipped=len(dupes),
            skipped_emails=skipped_emails,
            user_ids=inserted_ids,
        )


# --------------------------------------------------------------------------
# QR generation
# --------------------------------------------------------------------------

@router.get("/qr/export.zip")
async def export_all_qrs(
    q: str | None = Query(default=None, max_length=120),
    box_size: int = Query(default=12, ge=2, le=40),
):
    """Every matching attendee's QR as a ZIP of PNGs.

    QR images are derived data, so they are generated here on demand rather
    than stored - a corrected name yields a corrected QR with no migration.
    """
    cursor = get_db().users.find(_search_filter(q)).sort("name", 1)

    buf = io.BytesIO()
    used_names: set[str] = set()
    count = 0

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        async for user in cursor:
            # Two attendees can share a name; the id suffix keeps files distinct.
            filename = f"{_slugify(user['name'])}-{user['user_id'][:8]}.png"
            if filename in used_names:
                continue
            used_names.add(filename)

            archive.writestr(filename, render_png(build_payload(user), box_size=box_size))
            count += 1

    if count == 0:
        raise HTTPException(status_code=404, detail="No attendees match; nothing to export.")

    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="qr-codes-{count}.zip"',
            "X-QR-Count": str(count),
        },
    )


def _pdf_response(users: list[dict], stem: str) -> Response:
    pages = -(-len(users) // PER_PAGE)  # ceiling division
    return Response(
        content=build_badge_pdf(users),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}.pdf"',
            "X-Badge-Count": str(len(users)),
            "X-Page-Count": str(pages),
            # The browser needs these visible to read them off a fetch().
            "Access-Control-Expose-Headers": "X-Badge-Count, X-Page-Count, Content-Disposition",
        },
    )


@router.get("/qr/export.pdf")
async def export_badges_pdf(q: str | None = Query(default=None, max_length=120)):
    """Printable badge sheet for every matching attendee: 16 QR codes per A4."""
    users = [doc async for doc in get_db().users.find(_search_filter(q)).sort("name", 1)]
    if not users:
        raise HTTPException(status_code=404, detail="No attendees match; nothing to print.")
    return _pdf_response(users, "attendee-badges")


@router.post("/qr/export.pdf")
async def export_badges_pdf_for(payload: BadgeRequest):
    """Badge sheet for a specific set of attendees - the ones just imported.

    Ordering follows the request so a sheet matches the order of the uploaded
    spreadsheet, which makes handing badges out far easier.
    """
    found = {
        doc["user_id"]: doc
        async for doc in get_db().users.find({"user_id": {"$in": payload.user_ids}})
    }
    users = [found[uid] for uid in payload.user_ids if uid in found]
    if not users:
        raise HTTPException(status_code=404, detail="None of those attendees exist.")
    return _pdf_response(users, "attendee-badges")


@router.get("/{user_id}/qr")
async def get_user_qr(
    user_id: str,
    format: str = Query(default="png", pattern="^(png|base64)$"),
    box_size: int = Query(default=10, ge=2, le=40),
):
    """The user's QR code, as a raw PNG or as a base64 data URI."""
    user = await _find_user_or_404(user_id)
    data = build_payload(user)

    if format == "base64":
        return {
            "user_id": user_id,
            "payload": data,
            "image": render_data_uri(data, box_size=box_size),
        }

    return Response(
        content=render_png(data, box_size=box_size),
        media_type="image/png",
        headers={
            "Content-Disposition": f'inline; filename="qr-{user_id}.png"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{user_id}/payload")
async def get_user_payload(user_id: str) -> dict:
    """The exact string encoded in the QR - handy for debugging a scan."""
    user = await _find_user_or_404(user_id)
    data = build_payload(user)
    return {"user_id": user_id, "payload": data, "length": len(data)}
