"""The participating schools, and the Prodigy ID built from them.

One source of truth: the backend owns the list and serves it to the frontend
at /api/schools, so adding a school means editing this file and nothing else.
"""

import re

# id -> name, exactly as the organisers supplied them.
SCHOOLS: dict[int, str] = {
    2: "ZION GENESIS PUBLIC SCHOOL",
    3: "AMM SCHOOL",
    4: "D.A.V. SCHOOL, ADAMBAKKAM",
    5: "Zion Matriculation Higher Secondary School, Madambakkam",
    6: "Bethel Matriculation Higher Secondary School",
    7: "Sri Sankara Vidyalaya Matriculation Higher Secondary School",
    8: "P S Senior Secondary School",
    9: "D.A.V. Matriculation Hr. Sec. School, Gillnagar, Chennai 94",
    10: "Madras Christian College Higher Secondary School, Chetpet",
    11: "P.S.B.B. Sr. Sec. School, K K Nagar",
    12: "Jaigopal Garodia Vivekananda Vidyalaya, Anna Nagar",
    13: "ZION MATRICULATION HIGHER SECONDARY SCHOOL, SEMBAKKAM",
}

# Three digits of serial, so one school+class pair tops out here.
SERIAL_DIGITS = 3
MAX_SERIAL = 10**SERIAL_DIGITS - 1


def _key(name: str) -> str:
    """Collapse a school name to something two spellings can agree on."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


_BY_KEY = {_key(name): school_id for school_id, name in SCHOOLS.items()}


def school_id_for(name: str | None) -> int | None:
    """Match a spreadsheet's school name back to its id, or None if unlisted."""
    return _BY_KEY.get(_key(name)) if name else None


def build_prodigy_id(school_id: int, standard: int, serial: int) -> int:
    """<school_id padded to 2><class><serial padded to 3>, as a number.

    School 2, class 9, first student  -> "029" + "001" -> 29001
    School 13, class 12, first        -> "1312" + "001" -> 1312001

    Stored as an int, so the school's leading zero is not kept. That is safe
    only because school ids stop at 13 and classes start at 9: no two valid
    combinations produce the same number. `test_prodigy_ids.py` proves it by
    brute force rather than by argument.
    """
    if serial > MAX_SERIAL:
        raise ValueError(
            f"Class {standard} at this school already has {MAX_SERIAL} students "
            "with a Prodigy ID; the format has no room for more."
        )
    return int(f"{school_id:02d}{standard}{serial:0{SERIAL_DIGITS}d}")


def serial_of(prodigy_id: int) -> int:
    """The trailing serial, used to keep the counter above hand-typed ids."""
    return prodigy_id % (10**SERIAL_DIGITS)
