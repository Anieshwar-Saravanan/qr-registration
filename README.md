# QR Registration — Phase 1

Generates a scannable QR code for each attendee stored in MongoDB Atlas.

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

Seed sample attendees: `cd backend && uv run python seed.py`

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
- The Mongo client is created once in the FastAPI lifespan and reused, so there
  is no TLS handshake per request.
- QR images are never stored. They are derived from the user record, so
  generating on demand means a corrected name yields a corrected QR with no
  migration and no stale images.
- OpenCV's `QRCodeDetector` intermittently fails to detect valid QR codes
  produced here; `zxing-cpp` decodes all of them. Use a ZXing-based library for
  the Phase 2 scanner.
