"""Every valid (school, class, serial) must produce a distinct Prodigy ID.

The format drops the school's leading zero when stored as a number, which is
only safe because of the actual ranges involved. This proves it by brute force
instead of by argument - and will fail loudly if a school id above 13 is ever
added, which is exactly when the reasoning stops holding.

Run:  uv run python test_prodigy_ids.py
"""

from app.models import STANDARD_MAX, STANDARD_MIN
from app.schools import MAX_SERIAL, SCHOOLS, build_prodigy_id, school_id_for, serial_of


def test_no_collisions() -> None:
    seen: dict[int, tuple[int, int, int]] = {}
    for school_id in SCHOOLS:
        for standard in range(STANDARD_MIN, STANDARD_MAX + 1):
            for serial in range(1, MAX_SERIAL + 1):
                pid = build_prodigy_id(school_id, standard, serial)
                combo = (school_id, standard, serial)
                assert pid not in seen, f"{combo} collides with {seen[pid]} on {pid}"
                seen[pid] = combo
    print(f"  {len(seen)} ids across {len(SCHOOLS)} schools, no collisions")


def test_serial_round_trips() -> None:
    for school_id in SCHOOLS:
        for standard in range(STANDARD_MIN, STANDARD_MAX + 1):
            for serial in (1, 7, 42, 999):
                assert serial_of(build_prodigy_id(school_id, standard, serial)) == serial
    print("  serial_of() recovers the serial from every id")


def test_overflow_is_refused() -> None:
    try:
        build_prodigy_id(2, 9, MAX_SERIAL + 1)
    except ValueError as e:
        print(f"  1000th student refused: {e}")
    else:
        raise AssertionError("a 1000th serial should not fit in three digits")


def test_name_lookup() -> None:
    for school_id, name in SCHOOLS.items():
        assert school_id_for(name) == school_id
        assert school_id_for(name.upper()) == school_id
        assert school_id_for(name.lower().replace(".", "").replace(",", "")) == school_id
    assert school_id_for("Some Other School") is None
    assert school_id_for(None) is None
    assert school_id_for("") is None
    print("  every listed name matches back to its id, punctuation and case ignored")


if __name__ == "__main__":
    for check in (test_no_collisions, test_serial_round_trips, test_overflow_is_refused, test_name_lookup):
        print(check.__name__)
        check()
    print("all prodigy id checks passed")
