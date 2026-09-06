# QR Registration

Generates a scannable QR badge for each attendee, then registers them into an
event by scanning that badge at the door — offline-capable.

- **Backend:** FastAPI + PyMongo async (`AsyncMongoClient`)
- **Frontend:** React 18 + Vite 5
- **Database:** MongoDB Atlas

## Setup

Create `.env` at the repo root (see `.env.example`):

```
MONGO_URL=mongodb+srv://qr_app:PASSWORD@qr-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
DB_NAME=qr_registration
```

Verify the connection before anything else:

```bash
uv run --with pymongo --with certifi --with python-dotenv python test_connection.py
```

## Run

Two terminals:

```bash
# 1) API on :8000
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 2) UI on :5173
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>. Interactive API docs at <http://localhost:8000/docs>.

**Testing the scanner on a phone** needs HTTPS — browsers expose the camera only
on `https://` or `localhost`, so a plain LAN address silently never starts it:

```bash
cd frontend && npm run dev:https      # serves on https://<your-lan-ip>:5173
```

Accept the self-signed certificate warning once per device.

Seed sample attendees: `cd backend && uv run python seed.py`

## Deployment

The frontend and backend deploy **separately**. Vercel runs Python as
serverless functions, which breaks the pooled Mongo connection this app relies
on — every cold invocation would open a new TLS connection to Atlas, and the
`lifespan` startup hook does not run meaningfully. So:

- **Frontend → Vercel** (static Vite build; exactly what Vercel is best at)
- **Backend → Render / Railway / Fly** (a long-lived process, so pooling works)

### Frontend on Vercel

1. Import the GitHub repo, then set **Root Directory = `frontend`** — the repo
   root has no `package.json` and the build will fail without this.
2. Framework preset: Vite (auto-detected). Build `npm run build`, output `dist`.
3. Environment variable:
   ```
   VITE_API_BASE=https://<your-backend-host>
   ```
   No trailing slash. **Vite inlines this at build time**, so changing it later
   requires a redeploy, not just an env var edit.

### Backend

Set these on the backend host:

```
MONGO_URL=mongodb+srv://...        # same as local .env
DB_NAME=qr_registration
CORS_ORIGINS=https://<your-app>.vercel.app
ALLOW_VERCEL_PREVIEWS=1            # optional: allow *.vercel.app preview URLs
```

Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

In Atlas → Network Access, add `0.0.0.0/0`: these hosts have rotating egress
IPs. Authentication and TLS still apply.

### Order matters

The frontend is useless until `VITE_API_BASE` points at a live backend, so
deploy the backend first, then build the frontend against it.

Both must be HTTPS. A browser on an `https://` page blocks requests to an
`http://` API as mixed content, and the scanner's camera needs a secure context
regardless.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/users` | Create attendee (409 on duplicate email) |
| `GET` | `/api/users` | List/search attendees — `?q=`, `?limit=`, `?offset=` |
| `GET` | `/api/users/{user_id}` | Fetch one attendee |
| `GET` | `/api/users/{user_id}/qr` | QR as PNG (`?format=base64` for a data URI) |
| `POST` | `/api/users/import/preview` | Parse a .csv/.xlsx and report what would happen — **writes nothing** |
| `POST` | `/api/users/bulk` | Commit many attendees, skipping existing emails |
| `GET` | `/api/users/qr/export.zip` | Every QR as a ZIP of PNGs (respects `?q=`) |
| `GET` | `/api/users/qr/export.pdf` | Printable badge sheet, 16 per A4 (respects `?q=`) |
| `POST` | `/api/users/qr/export.pdf` | Badge sheet for a specific `user_ids` list |
| `GET` | `/api/users/{user_id}/payload` | The exact string encoded in the QR |

## QR payload

Versioned JSON, compact-separated:

```json
{"v":1,"type":"user","user_id":"<uuid>","name":"...","email":"...","org":"..."}
```

`build_payload()` in `backend/app/qr.py` is the **only** place that decides what
goes into a QR. Phase 2's switch to an opaque signed token changes that function
and nothing else — `user_id` is already stored on every document and carried in
every payload, so no schema migration is needed.

## Events and scanning

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` `GET` | `/api/events` | Create / list events with registration counts |
| `PATCH` | `/api/events/{id}` | Rename, set capacity, open or close |
| `POST` | `/api/events/{id}/scan` | Register whoever the scanned badge identifies |
| `POST` | `/api/events/{id}/scan/sync` | Replay a batch of scans queued offline |
| `POST` | `/api/events/{id}/register` | Manual registration by `user_id` |
| `DELETE` | `/api/events/{id}/registrations/{user_id}` | Undo a mis-scan |
| `POST` | `/api/events/{id}/registrations/remove` | Remove several at once (`user_ids`) |
| `GET` `PUT` | `/api/events/{id}/winners` | Read / replace the event's placings |
| `GET` | `/api/events/{id}/registrations` | Who has checked in — supports `?q=` |
| `GET` | `/api/events/{id}/stats` | Counts by method, latest registration |
| `GET` | `/api/events/{id}/registrations/export.csv` | Post-event export |

A scan resolves to one of six outcomes: `registered`, `already_registered`,
`unknown_user`, `invalid_qr`, `event_closed`, `event_full`.

**Double-scanning is settled by the database.** A unique compound index on
`(event_id, user_id)` means a repeated scan — or two volunteers scanning the
same badge simultaneously — produces exactly one registration and a friendly
"already registered" for the rest. Verified with 12 concurrent requests: 1
registered, 11 already registered, 1 row. An application-level check-then-insert
would have a race window that a busy door finds within minutes.

**The database is the source of truth at scan time.** Only `user_id` is read
from the QR; the name and email inside it are display hints from whenever the
badge was printed. A badge printed before a name correction still registers the
right person with the right details.

## Attendee table

Each event's registrations are shown as a sortable-width table — number, name,
email, organization, registration time, and how they were registered (scan or
manual, with the device id). Long emails and organizations truncate with the
full value in a tooltip so the Remove column always stays visible.

Removal works two ways: a **Remove** button per row, or checkboxes plus
**Remove selected** for a batch. Bulk removal is one request rather than one
per person, and reports honestly (`removed: 1, requested: 2` when an id no
longer exists).

Removing someone un-registers them from that event only — they stay in the
attendee list, their QR badge stays valid, and they can be registered again.
Verified: remove, re-register, and the duplicate guard still fires on a second
attempt.

## Winners

Winners are picked from the event's registered attendees, in order — 1st, 2nd,
3rd and onwards — and reordered with arrows. Positions always renumber to 1..n,
so removing second place promotes third rather than leaving a gap.

`PUT` replaces the entire list rather than editing one placing at a time; a
partial update could briefly leave two people sharing a position. The endpoint
rejects duplicate positions, the same person winning twice, and unknown
attendees.

Names are snapshotted alongside the id, so a results image stays true to what
was announced even if an attendee record is edited afterwards.

**The shareable image** is drawn on a canvas in `frontend/src/lib/winnerImage.js`
and downloaded as a PNG: a dark title band with the event name and venue, then a
full table — **# · Name · Organization · Email · Phone** — with a
gold/silver/bronze disc for the top three and the ordinal (`4th`, `12th`) beyond.
Missing values render as an em dash rather than a blank cell.

Column widths live in one `COLUMNS` array and the image width is derived from
them, so adding or removing a column cannot leave the layout inconsistent.
Rendered at 3x, and the preview is displayed at its design width rather than
stretched — stretching upscales past the rendered resolution and looks soft.

Canvas rather than server-side rendering: the browser always has usable fonts,
whereas generating this on the backend would mean bundling a font for Render's
Linux image. Every cell ellipsises to fit its column.

## Offline scanning

Scans are written to IndexedDB **first** and uploaded second, so the door keeps
moving whether or not the network does. A persistent indicator shows connection
state and queue depth; sync runs on reconnect, every 15s while online, and on
demand.

Three things make offline work rather than merely not-crash:

- **The roster is cached on the device** (`Download roster for offline`). Without
  it an offline scan is blind — it could not show a name, reject a badge that is
  not on the list, or notice a repeat. Download it before going offline.
- **Original scan times are preserved.** Each queued scan carries its own
  `scanned_at`, so a scan synced three hours late still records when the person
  actually walked in. Verified: scans queued 2 hours prior synced back as 120,
  117 and 114 minutes old.
- **Device clocks are sanity-checked, not blindly trusted.** Past-dated scans are
  expected and accepted (that is what an offline queue *is*); only future-dated
  or absurdly old timestamps are replaced with server time and flagged with
  `clock_skew_seconds`.

Two volunteers offline can both scan the same person — neither device can know.
On sync the first write wins and the second is reported as already registered,
in the sync summary rather than silently.

`frontend/src/lib/payload.js` mirrors `backend/app/qr.py` so a device can parse
badges without a network. That duplication is deliberate and the two must change
together; the server re-validates every scan regardless, so the client copy is a
UX fast path, never the security boundary.

## Spreadsheet import

Upload is two steps on purpose: `preview` parses and validates without touching
the database, so a wrong column guess is caught by a human before it writes 300
malformed records. The UI then posts only the rows marked `ok` to `bulk`.

Two sample files live in `samples/` — `sample_attendees.csv` (12 valid
attendees) and `sample_attendees_with_errors.csv` (deliberately broken rows, to
see the preview classify them).

Column headers are matched by an alias table first, then by substring rules, so
`Full Name`, `E-mail Address`, `Mobile No` and `Company` all resolve correctly.
Rows are classified `ok`, `invalid`, `duplicate_in_file` or `already_exists`;
only `ok` rows are imported and everything else is shown in the preview.

Handled deliberately, because real spreadsheets contain all of it:

- UTF-8 BOM and cp1252 encodings from Excel-on-Windows exports
- Phone numbers Excel widened to floats (`9840011223.0`) or scientific notation
- Hundreds of phantom trailing rows
- Mixed-case emails, which a case-sensitive unique index would let in twice
- Legacy `.xls`, rejected with an actionable message rather than a parse error

Limits: 5MB, 5000 rows.

## Printable badge sheets

`backend/app/pdf.py` lays out **16 badges per A4** as a 4x4 grid with cut
guides: QR code, name in bold, organization in grey beneath it. Attendees with
no organization simply omit that line.

Two ways in:

- **After an import**, "Print badges for these N" covers exactly the attendees
  that import created — `POST` with their `user_ids`, in spreadsheet order, so
  the printed sheet matches the order you uploaded.
- **From the attendee list**, "Print badges (PDF)" covers everyone matching the
  current search, so one company's badges can be printed on their own.

The QR is generated from the attendee record, which means a badge can only be
printed for someone already in the database — a QR whose `user_id` does not
exist would be rejected at the door. Import first, then print.

Verified by rendering the PDF at 300dpi and decoding: 40 badges produce 3 pages
and all 40 scan. Long names and organizations are ellipsised to fit the cell.

**Limitation:** ReportLab's built-in fonts are Latin-1, so accented names
("Zoë Müller") print correctly but non-Latin scripts degrade to `?`. The QR
still carries the real record and scans correctly. Supporting other scripts
means registering a TrueType font with the needed glyphs.

## Search

`GET /api/users?q=` does a case-insensitive substring match across name, email
and organization. The query is regex-escaped, so punctuation in a search box
cannot break the query or pin the server on a pathological pattern.

Being an unanchored regex, it is a collection scan — fine into the low
thousands. If fuzzy/typo-tolerant matching is ever needed, Atlas Search is
available on the M0 tier and is the upgrade path.

## Data model

`users` collection, unique indexes on `email` and `user_id`:

```
{ _id, user_id (uuid4), name, email, phone, organization, created_at }
```

## Notes

- Vite is pinned to 5.x because Node v18 is installed; Vite 6+ needs Node 20+.
  This also forces `@vitejs/plugin-basic-ssl` to the v1 line.
- The scanner bundle (~340KB) is lazy-loaded, so opening the app costs 162KB
  rather than 502KB — it matters on venue wifi.
- Volunteers scan without logging in. Each browser generates a stable device id
  recorded against every scan, giving most of the audit value of accounts at
  none of the cost.
- The Mongo client is created once in the FastAPI lifespan and reused, so there
  is no TLS handshake per request.
- QR images are never stored. They are derived from the user record, so
  generating on demand means a corrected name yields a corrected QR with no
  migration and no stale images.
- OpenCV's `QRCodeDetector` intermittently fails to detect valid QR codes
  produced here; `zxing-cpp` decodes all of them. Use a ZXing-based library for
  the Phase 2 scanner.
