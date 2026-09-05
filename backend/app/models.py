"""Request and response shapes for the users API."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    organization: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        # Mongo's unique index is case-sensitive, so without this
        # "A@x.com" and "a@x.com" would both insert as separate people.
        return v.strip().lower()

    @field_validator("name", "phone", "organization")
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


def to_user_out(doc: dict) -> UserOut:
    """Mongo document -> API model, dropping the internal _id."""
    return UserOut(**{k: v for k, v in doc.items() if k != "_id"})
