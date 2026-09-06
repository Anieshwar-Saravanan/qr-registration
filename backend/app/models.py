"""Request and response shapes for the users API."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class UserCreate(BaseModel):
    # Validated in `require_name` rather than with min_length, so a name of
    # only spaces reports "Name is required" instead of Pydantic's
    # "String should have at least 1 character".
    name: str = Field(max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    organization: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        # Mongo's unique index is case-sensitive, so without this
        # "A@x.com" and "a@x.com" would both insert as separate people.
        return v.strip().lower()

    @field_validator("name")
    @classmethod
    def require_name(cls, v: str) -> str:
        name = (v or "").strip()
        if not name:
            raise ValueError("Name is required.")
        return name

    @field_validator("phone", "organization")
    @classmethod
    def strip_blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None


class UserOut(BaseModel):
    user_id: str
    name: str
    email: EmailStr
    phone: str | None = None
    organization: str | None = None
    created_at: datetime


class UserPage(BaseModel):
    """Paginated list response, so search works the same at 50 or 50,000."""

    items: list[UserOut]
    total: int
    limit: int
    offset: int


class ImportRow(BaseModel):
    """One parsed spreadsheet row and what we intend to do with it."""

    row_number: int
    status: Literal["ok", "invalid", "duplicate_in_file", "already_exists"]
    data: UserCreate | None = None
    raw: dict[str, str] = {}
    error: str | None = None


class ImportPreview(BaseModel):
    filename: str
    detected_columns: list[str]
    column_mapping: dict[str, str]
    unmapped_columns: list[str]
    rows: list[ImportRow]
    summary: dict[str, int]


class BulkCreate(BaseModel):
    users: list[UserCreate] = Field(min_length=1, max_length=5000)


class BulkResult(BaseModel):
    inserted: int
    skipped: int
    skipped_emails: list[str]
    # Ids of the attendees actually created, so a badge sheet can be printed
    # for exactly this import rather than the whole database.
    user_ids: list[str] = []


def to_user_out(doc: dict) -> UserOut:
    """Mongo document -> API model, dropping the internal _id."""
    return UserOut(**{k: v for k, v in doc.items() if k != "_id"})


# ---------------------------------------------------------------------------
# Phase 2: events, registrations and scanning
# ---------------------------------------------------------------------------

class EventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    venue: str | None = Field(default=None, max_length=160)
    starts_at: datetime | None = None
    capacity: int | None = Field(default=None, ge=1, le=1_000_000)
    # Existing events predate this field; the migration set them all to
    # "individual", which is exactly how they already behaved.
    event_type: Literal["individual", "team"] = "individual"
    team_size_min: int | None = Field(default=None, ge=2, le=50)
    team_size_max: int | None = Field(default=None, ge=2, le=50)

    @model_validator(mode="after")
    def check_team_sizes(self):
        if self.event_type == "team":
            if self.team_size_min is None or self.team_size_max is None:
                raise ValueError("A team event needs a minimum and maximum team size.")
            if self.team_size_min > self.team_size_max:
                raise ValueError("Minimum team size cannot exceed the maximum.")
        return self


class EventUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    venue: str | None = Field(default=None, max_length=160)
    starts_at: datetime | None = None
    capacity: int | None = Field(default=None, ge=1, le=1_000_000)
    status: Literal["open", "closed"] | None = None
    event_type: Literal["individual", "team"] | None = None
    team_size_min: int | None = Field(default=None, ge=2, le=50)
    team_size_max: int | None = Field(default=None, ge=2, le=50)


class EventOut(BaseModel):
    event_id: str
    name: str
    venue: str | None = None
    starts_at: datetime | None = None
    capacity: int | None = None
    status: Literal["open", "closed"]
    created_at: datetime
    registered_count: int = 0
    event_type: Literal["individual", "team"] = "individual"
    team_size_min: int | None = None
    team_size_max: int | None = None
    team_count: int = 0


ScanStatus = Literal[
    "registered",
    "already_registered",
    "unknown_user",
    "invalid_qr",
    "event_closed",
    "event_full",
]


class ScanRequest(BaseModel):
    """One scan, from a live camera or replayed from an offline queue."""

    payload: str = Field(max_length=4096)
    device_id: str | None = Field(default=None, max_length=64)
    # Idempotency key generated on the device, so a retried sync cannot
    # produce a second registration.
    scan_id: str | None = Field(default=None, max_length=64)
    # When the scan actually happened. A scan queued offline and synced three
    # hours later must still record the time the person walked in.
    scanned_at: datetime | None = None


class ScanResult(BaseModel):
    status: ScanStatus
    message: str
    user: UserOut | None = None
    registered_at: datetime | None = None
    scan_id: str | None = None


class SyncRequest(BaseModel):
    scans: list[ScanRequest] = Field(min_length=1, max_length=500)


class SyncResult(BaseModel):
    results: list[ScanResult]
    summary: dict[str, int]


class ManualRegister(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    device_id: str | None = Field(default=None, max_length=64)


class RegistrationOut(BaseModel):
    registration_id: str
    event_id: str
    user_id: str
    name: str
    email: str
    phone: str | None = None
    organization: str | None = None
    registered_at: datetime
    method: Literal["scan", "manual"]
    device_id: str | None = None
    # Null for an individual registration.
    team_id: str | None = None
    team_name: str | None = None
    # Set only when a device's clock disagreed sharply with the server's.
    clock_skew_seconds: int | None = None


class RegistrationPage(BaseModel):
    items: list[RegistrationOut]
    total: int
    limit: int
    offset: int


class EventStats(BaseModel):
    event_id: str
    registered: int
    total_attendees: int
    capacity: int | None = None
    by_method: dict[str, int]
    last_registration_at: datetime | None = None


def to_event_out(doc: dict, registered_count: int = 0, team_count: int = 0) -> EventOut:
    return EventOut(
        **{k: v for k, v in doc.items() if k != "_id"},
        registered_count=registered_count,
        team_count=team_count,
    )


def to_registration_out(doc: dict) -> RegistrationOut:
    snap = doc.get("user_snapshot", {})
    return RegistrationOut(
        registration_id=doc["registration_id"],
        event_id=doc["event_id"],
        user_id=doc["user_id"],
        name=snap.get("name", "(unknown)"),
        email=snap.get("email", ""),
        phone=snap.get("phone"),
        organization=snap.get("organization"),
        registered_at=doc["registered_at"],
        method=doc.get("method", "scan"),
        device_id=doc.get("device_id"),
        team_id=doc.get("team_id"),
        team_name=doc.get("team_name"),
        clock_skew_seconds=doc.get("clock_skew_seconds"),
    )


class BadgeRequest(BaseModel):
    """Specific attendees to put on a badge sheet, e.g. the ones just imported."""

    user_ids: list[str] = Field(min_length=1, max_length=2000)


class RemoveRegistrations(BaseModel):
    """Attendees to un-register from an event."""

    user_ids: list[str] = Field(min_length=1, max_length=500)


class TeamMemberOut(BaseModel):
    user_id: str
    name: str
    email: str
    phone: str | None = None
    organization: str | None = None


class WinnerEntry(BaseModel):
    """One placing. Position 1 is first place.

    A placing is awarded to a person or to a team, never both: which one is
    decided by the event's type, and the router enforces the match.
    """

    position: int = Field(ge=1, le=100)
    user_id: str | None = Field(default=None, min_length=1, max_length=64)
    team_id: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def exactly_one_subject(self):
        if bool(self.user_id) == bool(self.team_id):
            raise ValueError("A placing is awarded to either a person or a team.")
        return self


class WinnersUpdate(BaseModel):
    # An empty list is meaningful: it clears the winners.
    winners: list[WinnerEntry] = Field(default_factory=list, max_length=50)


class WinnerOut(BaseModel):
    position: int
    kind: Literal["user", "team"] = "user"
    # The winner's display name: the person's name, or the team's.
    name: str
    user_id: str | None = None
    email: str = ""
    phone: str | None = None
    organization: str | None = None
    # Team placings only. Snapshotted with the placing so the results image
    # still lists who was on the team even if it is disbanded afterwards.
    team_id: str | None = None
    members: list[TeamMemberOut] = Field(default_factory=list)


def to_winner_out(entry: dict) -> WinnerOut:
    if entry.get("team_id"):
        return WinnerOut(
            position=entry["position"],
            kind="team",
            team_id=entry["team_id"],
            name=entry.get("name", "(unknown team)"),
            members=[TeamMemberOut(**m) for m in entry.get("members", [])],
        )
    return WinnerOut(
        position=entry["position"],
        kind="user",
        user_id=entry["user_id"],
        name=entry.get("name", "(unknown)"),
        email=entry.get("email", ""),
        phone=entry.get("phone"),
        organization=entry.get("organization"),
    )


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    member_ids: list[str] = Field(min_length=1, max_length=50)
    device_id: str | None = Field(default=None, max_length=64)
    # Preserved from the device for a team formed offline and synced later.
    created_at: datetime | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        name = " ".join(v.split())
        if not name:
            raise ValueError("Team name is required.")
        return name

    @model_validator(mode="after")
    def unique_members(self):
        if len(set(self.member_ids)) != len(self.member_ids):
            raise ValueError("The same person cannot be in a team twice.")
        return self


class TeamOut(BaseModel):
    team_id: str
    event_id: str
    name: str
    size: int
    members: list[TeamMemberOut]
    created_at: datetime
    device_id: str | None = None
    # Set when the requested name collided and the team was renamed on save.
    renamed_from: str | None = None


def to_team_out(doc: dict) -> TeamOut:
    return TeamOut(
        team_id=doc["team_id"],
        event_id=doc["event_id"],
        name=doc["name"],
        size=doc.get("size", len(doc.get("members", []))),
        members=[TeamMemberOut(**m) for m in doc.get("members", [])],
        created_at=doc["created_at"],
        device_id=doc.get("device_id"),
        renamed_from=doc.get("renamed_from"),
    )
