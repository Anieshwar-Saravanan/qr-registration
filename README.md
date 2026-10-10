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
| `POST` | `/api/users` | Create attendee (409 on duplicate roll no) |
| `GET` | `/api/users` | List/search attendees — `?q=`, `?limit=`, `?offset=` |
| `GET` | `/api/users/{user_id}` | Fetch one attendee |
| `GET` | `/api/users/{user_id}/qr` | QR as PNG (`?format=base64` for a data URI) |
| `POST` | `/api/users/import/preview` | Parse a .csv/.xlsx and report what would happen — **writes nothing** |
| `POST` | `/api/users/bulk` | Commit many attendees, skipping existing roll nos |
| `DELETE` | `/api/users/{user_id}` | Delete a student with their registrations and team memberships |
| `GET` | `/api/users/schools` | The participating schools, for the dropdown |
| `GET` | `/api/users/qr/export.zip` | Every QR as a ZIP of PNGs (respects `?q=`) |
| `GET` | `/api/users/qr/export.pdf` | Printable badge sheet, 16 per A4 (respects `?q=`) |
| `POST` | `/api/users/qr/export.pdf` | Badge sheet for a specific `user_ids` list |
| `GET` | `/api/users/{user_id}/payload` | The exact string encoded in the QR |

## QR payload

Versioned JSON, compact-separated:

```json
{"v":1,"type":"user","user_id":"<uuid>","name":"...","roll":"...","pid":42}
```

Only the fields printed on the badge ride along as display hints. The rest stay
out: every byte is a denser QR and a harder scan, and an offline scanner reads
the full record from its cached roster instead.

`build_payload()` in `backend/app/qr.py` is the **only** place that decides what
goes into a QR. Phase 2's switch to an opaque signed token changes that function
and nothing else — `user_id` is already stored on every document and carried in
every payload, so no schema migration is needed.

## Adding participants

One card on the Events tab, four modes:

- **Scan QR** — the camera scanner, still lazy-loaded (html5-qrcode is ~350KB
  and most sessions never open it).
- **Prodigy ID** — type the number, exact match only. The general search is a
  substring match, so `7` also returns every roll number containing a 7; that
  is right for browsing a list and useless at a desk with a queue.
- **By name** — search and click.
- **New student** — creates them *and* registers them in one step, because the
  student standing at the desk is being added to this event, not just to the
  master list.

There is no separate Scan tab: scanning is a way of adding a participant, not
a destination.

## Events and scanning

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` `GET` | `/api/events` | Create / list events with registration counts |
| `PATCH` | `/api/events/{id}` | Edit name, venue, capacity, type or status |
| `DELETE` | `/api/events/{id}` | Delete an event with its registrations and teams |
| `POST` | `/api/events/{id}/scan` | Register whoever the scanned badge identifies |
| `POST` | `/api/events/{id}/scan/sync` | Replay a batch of scans queued offline |
| `POST` | `/api/events/{id}/register` | Manual registration by `user_id` (plus `team_id` on a team event) |
| `DELETE` | `/api/events/{id}/registrations/{user_id}` | Undo a mis-scan |
| `POST` | `/api/events/{id}/registrations/remove` | Remove several at once (`user_ids`) |
| `GET` `PUT` | `/api/events/{id}/winners` | Read / replace the event's placings |
| `GET` `POST` | `/api/events/{id}/teams` | List / create teams (team events only) |
| `DELETE` | `/api/events/{id}/teams/{team_id}` | Disband a team and un-register its members |
| `GET` | `/api/events/{id}/registrations` | Who has checked in — supports `?q=` |
| `GET` | `/api/events/{id}/stats` | Counts by method, latest registration |
| `GET` | `/api/events/{id}/registrations/export.csv` | Post-event export |

A scan resolves to one of six outcomes: `registered`, `already_registered`,
`unknown_user`, `invalid_qr`, `event_closed`, `event_full`.

### Editing and deleting an event

Each event row carries a `⋯` menu with **Edit**, **Close/Reopen** and
**Delete**. Edit opens the create form's own fields inline beneath the row —
one `EventFields` component serves both, so the two forms cannot drift apart —
and the row stays visible above it as the thing being edited. Saving refreshes
the selection as well as the list: the panels below read the event's type and
team sizes, so leaving them on the stale copy would show a team event with an
individual scanner.

Two guards sit on `PATCH`. Turning a team event back into an individual one is
refused while teams exist (`409`, naming the count) rather than orphaning rows
nothing can display; and switching to individual clears `team_size_min/max`, so
stale bounds cannot resurrect if it is switched back.

`DELETE` removes the event's registrations and teams with it, and **never
touches attendees** — they belong to the attendee list, and their badges stay
valid for other events. Without `?force=true` it refuses any event that still
has registrations or teams, reporting the counts; the UI shows those counts in
a confirmation block and only then sends `force`. Rows are deleted before the
event itself, since an event that vanished mid-delete would leave its rows
invisible and unreachable.

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

## Team events

An event is `individual` (the default, and what every pre-existing event was
migrated to) or `team` with a `team_size_min`/`team_size_max` range.

**Teams are a grouping layer over registrations, not a replacement.** Each member
still gets their own registration row, carrying `team_id` and `team_name`. That
keeps the unique `(event_id, user_id)` index as the authority, so one person
cannot be in two teams, a double scan still cannot duplicate anyone, and the
registrations table, CSV export and stats all work unchanged.

`create_team` in `backend/app/teams.py` validates everything *before* writing:
event type and status, size against the range, every badge known, and nobody
already registered — naming who clashes and which team they are in. Validating
up front matters at a door: finding out at commit that one of five people is
already registered means the other four queued for nothing.

### Adding someone to a team by hand

The manual fallback ("badge won't scan") has to ask which team the person is
joining. On a team event `POST /register` **refuses a registration with no
`team_id`**: it used to succeed and leave someone on the roster with no team
beside them — a row that is neither valid nor easy to spot. A `team_id` sent to
an individual event is refused in the same way.

`add_team_member` claims the place with a single conditional update —
`{team_id, size: {$lt: team_size_max}}` with `$push`/`$inc` — so two organisers
filling the last seat at once cannot both win. Verified: six simultaneous adds
for one free place produced one registration and five refusals, with the team's
`size` still matching its member array. If the registration then fails (closed,
full, or someone registered in between) the claimed place is handed back.

The picker lists each team as `Alpha — 2/3 members`, disables any team already
at its maximum, and clears itself if the chosen team fills up or is disbanded
while it is selected.

Two devices offline can both name a team "Alpha" and neither can know. The
second is saved as `Alpha (2)` with `renamed_from` recorded, rather than
rejected — turning away a team whose members have already walked in would be
worse than renaming it.

If a member is registered in the narrow window between validation and insert,
the whole team is rolled back and reported rather than left half-registered.
Verified: 8 devices simultaneously submitting teams that share one member
produced exactly 1 team and 7 clear rejections, with nobody in two teams.

Disbanding a team removes its member registrations too — they were only
registered as part of it.

## Deleting a student

`DELETE /api/users/{id}` removes the student, their registrations, and pulls
them out of any team — a team left with nobody in it is deleted too. Without
`?force=true` it **refuses** anyone who is registered for an event, naming the
count; the UI asks once, and only asks a second time with those counts if the
server pushes back. A misplaced click cannot quietly undo a day's scanning.

**Saved winner placings are deliberately left alone.** A placing is a snapshot
taken when the result was announced, and a result should not change because
somebody tidied up the student list afterwards. `_user_winner_entries` falls
back to that snapshot for a student who no longer exists, so the list can still
be reordered and re-saved — the same thing team placings already do for a
disbanded team.

## Attendee table

Each event's registrations are shown as a sortable-width table — number, name,
PID, roll no, school, standard, score, registration time, and how they were
registered (scan or manual, with the device id). Long school names truncate
with the full value in a tooltip so the Remove column always stays visible;
the roll number and PID never truncate, since they identify the row.

Removal works two ways: a **Remove** button per row, or checkboxes plus
**Remove selected** for a batch. Bulk removal is one request rather than one
per person, and reports honestly (`removed: 1, requested: 2` when an id no
longer exists).

Removing someone un-registers them from that event only — they stay in the
attendee list, their QR badge stays valid, and they can be registered again.
Verified: remove, re-register, and the duplicate guard still fires on a second
attempt.

## Scores

Each registration and each team carries an optional `score`. It is edited in
place in the table and saved on **blur**, not per keystroke — one request per
score instead of one per digit. The box is keyed on the score so it re-mounts
when the value changes underneath it; an uncontrolled `defaultValue` would
otherwise show a stale number after a reload or a score typed on another
laptop.

Sorting is **server-side** (`?sort=score`). The table is paged, so sorting only
the rows already loaded would hide the top score on page 3. Mongo sorts null
below every number on a descending sort, which is what we want — unscored
competitors belong at the bottom, not the top, because "not scored yet" is not
"scored nothing".

## Winners

The Winners tab lists the event's competitors — teams for a team event,
registrations otherwise — sorted by score. **Right-click a row** (or use the ⋯
button, because right-click does not exist on a tablet at an event) to set 1st,
2nd, 3rd, append at the end, or clear.

**Top N** ranks the highest N scores 1..N in one click: "the top 8 go through
to round two" is a button, not eight right-clicks. A top-3 selection is a
podium and the image is headed WINNERS; anything wider is a shortlist and the
image is headed **TOP N** with a "participants" footer, because sending out a
round-two shortlist titled WINNERS misleads everyone who reads it.

Ranks always renumber to 1..n, so removing second place promotes third rather
than leaving a gap.

`PUT` replaces the entire list rather than editing one placing at a time; a
partial update could briefly leave two people sharing a position. The endpoint
rejects duplicate positions, the same subject winning twice, and unknown
attendees or teams.

Names **and the score** are snapshotted alongside the id, so a results image
stays true to what was announced even if a record is edited afterwards. The
score is read from the registration, not the student: the same student can
compete in several events with a different score in each.

### Team events are won by teams

For an event with `event_type: "team"`, the winners are teams, not individuals:
the picker lists the teams that formed, and each placing carries the team's
**whole member list**. A `WinnerEntry` therefore holds either a `user_id` or a
`team_id` — never both, never neither — and the endpoint rejects a placing whose
kind disagrees with the event, so a team event can never be given individual
winners or the reverse.

The member list is snapshotted with the placing, not looked up on read. Two
things follow: disbanding a team after it was announced does not empty out its
row (a re-save falls back to the stored snapshot rather than 404-ing), and
changing an event's `event_type` clears its winners, since a placing of the
wrong kind could be displayed but never saved again.

**The shareable image** is drawn on a canvas in `frontend/src/lib/winnerImage.js`
and downloaded as a PNG: a dark title band with the event name and venue, then a
full table — **# · Name · Roll No · Domain · Department · Phone** — with a
gold/silver/bronze disc for the top three and the ordinal (`4th`, `12th`) beyond.
Missing values render as an em dash rather than a blank cell.

For team results the same table takes a second row shape: a banded heading row
per team (medal, team name, member count) followed by one numbered row per
member with their PID, roll no, school and standard, so the full roster forwards
with the image instead of just the team names. The two shapes share the column
grid, the medals and the truncation, and `bodyHeight()` is the single place that
knows a team block is taller than a row.

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

### The locally-known registered set

Each device keeps `qr-reg.registered[event_id]` in IndexedDB — who it already
believes is checked in — and the scanner consults it before queueing anything,
so a repeat badge is caught instantly and offline. It is a cache, so it has to
be able to shrink as well as grow, by three routes:

- **Removing someone un-marks them** (`unmarkRegistered`), from a single
  removal, a bulk removal, or a team being disbanded. Without this the scanner
  keeps answering "already registered" for someone whose registration was
  deleted, and the server is never even asked.
- **A complete, unfiltered load rebuilds the set** rather than merging into it
  (`primeRegistered(..., { replace: true })`), which is how a device that did
  not do the removing heals itself. Merging is kept for a filtered or paged
  load: rebuilding from a search result would forget everyone not matching it.
- **Deleting an event forgets it entirely**, queued scans included — they could
  never be accepted, so they would retry forever.

Replace mode is seeded from the scans still queued on the device, not from
nothing: those people are registered as far as the door is concerned, and
dropping them would let a second scan through while the first was still waiting
to sync.

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
- Mixed-case roll numbers (`21cs001` / `21CS001`), which a case-sensitive unique
  index would otherwise let in twice
- Years written as `3`, `3rd`, `III` or `3rd Year`
- Legacy `.xls`, rejected with an actionable message rather than a parse error

Limits: 5MB, 5000 rows.

## Printable badge sheets

`backend/app/pdf.py` lays out **16 badges per A4** as a 4x4 grid with cut
guides: QR code, then **name** in bold, **PID** beneath it, and **school** in
grey below that. One `BADGE_LINES` table drives the block height and every
baseline, so a line can be added or removed without the layout drifting.

The baseline walks down a full line at a time whether or not that line has a
value, so someone with no school gets a badge laid out identically to everyone
else's on the sheet rather than sitting higher in its cell.

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
and all 40 scan. Long names and school names are ellipsised to fit the cell.

**Limitation:** ReportLab's built-in fonts are Latin-1, so accented names
("Zoë Müller") print correctly but non-Latin scripts degrade to `?`. The QR
still carries the real record and scans correctly. Supporting other scripts
means registering a TrueType font with the needed glyphs.

## Search

`GET /api/users?q=` does a case-insensitive substring match across name, roll
no, school, email and phone, plus an **exact** match on the Prodigy ID when
the query is all digits. Standard is deliberately left out of the substring
match: it is a number, and searching "9" would match every roll number and
phone number containing a 9. The query is regex-escaped, so punctuation in a search box cannot
break the query or pin the server on a pathological pattern.

Being an unanchored regex, it is a collection scan — fine into the low
thousands. If fuzzy/typo-tolerant matching is ever needed, Atlas Search is
available on the M0 tier and is the upgrade path.

## Data model

`users` collection, unique indexes on `roll_no` and `user_id`:

```
{ _id, user_id (uuid4), name, roll_no, prodigy_id,
  school_id, school, standard, phone, email, created_at }
```

**The Prodigy ID encodes the school and the class.** Format
`<school id, 2 digits><class><serial, 3 digits>`, stored as a number:

```
school 2,  class 9,  1st student  ->  029 001  ->    29001
school 2,  class 10, 1st student  ->  0210 001 ->   210001
school 13, class 12, 1st student  ->  1312 001 ->  1312001
```

Stored as an int, so the school's leading zero is lost. That is only safe
because school ids stop at 13 and classes start at 9 — no two valid
combinations collide. `backend/test_prodigy_ids.py` proves it by brute force
over all 47,952 combinations rather than by argument, and will fail the moment
a school id above 13 is added.

The serial counts **within a school and class**, so every class at every school
starts again at 001. Each pair has its own counter document, bumped with a
single atomic `$inc` — "read the highest, add one" would hand the same number
to two operators adding a student at the same moment. A bulk import takes one
reservation per school+class group, not one per row.

Leaving the field blank generates one; typing one keeps it and pushes that
group's counter past it, so auto-assignment never walks into a hand-typed id
later. A counter seeds itself from the highest stored id the first time it is
used, which covers a restored backup or a spreadsheet that carried its own ids.

**No school or no standard means no Prodigy ID.** The id encodes both, so a
student from an unlisted school ("Other") or with no class recorded simply does
not get one — better than inventing a number that contradicts their record.

The twelve participating schools live in `backend/app/schools.py` and are served
at `GET /api/users/schools`, so the frontend dropdown is not a second copy of
the list. A spreadsheet carrying school *names* has them matched back to ids
with punctuation and case ignored; once a row has an id, the stored name is the
canonical one, so twelve spellings of the same school cannot accumulate.

**Roll number and Prodigy ID are both unique when present**, each via a partial
index — a plain unique index treats every missing value as the same one and
would reject the second student left without a roll number. Import
duplicate-detection checks whichever of the two a row actually has; a row with
neither cannot be matched against anything, and is imported as new. Roll
numbers are stored upper-cased with internal whitespace collapsed, because the
index is case-sensitive and `9a01` and `9A01` are the same student.

Email is an ordinary optional field. It used to be the unique key, so
`_ensure_indexes` drops the old `email_1` index on startup: an index outlives
the code that created it, and a stale unique one would keep rejecting a second
attendee who has no email address.

The snapshot copied onto a registration, a team member and a winning placing is
defined once as `PersonFields` / `person_snapshot()` in `models.py`, so the
roster table, the CSV export, the team list and the results image cannot drift
into disagreeing about which fields a person carries.

**`position` vs `rank`.** An attendee has a `position` — their role in the club
— and a winner has a placing. Those cannot both be called `position` on a
winner row, so the placing is `rank` (1 is first place) throughout the winners
API and UI.

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
