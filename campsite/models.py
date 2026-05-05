from __future__ import annotations
from dataclasses import dataclass
from datetime import date, timedelta
import re
from typing import Iterator


@dataclass
class AvailableSite:
    site_id: str
    campground_id: str
    is_walkin: bool
    is_double: bool
    check_in: date
    check_out: date


@dataclass
class BookingResult:
    success: bool
    site: AvailableSite | None = None
    confirmation_number: str | None = None
    error_message: str | None = None


_DAY_NAMES: dict[str, int] = {
    "MON": 0, "MONDAY": 0,
    "TUE": 1, "TUESDAY": 1,
    "WED": 2, "WEDNESDAY": 2,
    "THU": 3, "THURSDAY": 3,
    "FRI": 4, "FRIDAY": 4,
    "SAT": 5, "SATURDAY": 5,
    "SUN": 6, "SUNDAY": 6,
}


def parse_date_expression(expr: str) -> list[tuple[date, date]]:
    """Parse a date expression into a list of (check_in, check_out) pairs."""
    s = expr.strip()

    # YYYY/MM/DD-YYYY/MM/DD — specific cross-month range
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})-(\d{4})/(\d{2})/(\d{2})", s)
    if m:
        y1, m1, d1, y2, m2, d2 = (int(x) for x in m.groups())
        return [(date(y1, m1, d1), date(y2, m2, d2))]

    # YYYY/MM/DD-DD — shorthand range within the same month
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})-(\d{2})", s)
    if m:
        y, mo, d1, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return [(date(y, mo, d1), date(y, mo, d2))]

    # YYYY/MM/DD — single night (check_out = check_in + 1 day)
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        check_in = date(y, mo, d)
        return [(check_in, check_in + timedelta(days=1))]

    upper = s.upper()

    # YYYY/MM/DAYNAME-DAYNAME — all weekday spans in the month
    m = re.fullmatch(r"(\d{4})/(\d{2})/([A-Z]+)-([A-Z]+)", upper)
    if m:
        y, mo, start_name, end_name = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)
        if start_name not in _DAY_NAMES or end_name not in _DAY_NAMES:
            raise ValueError(f"Unrecognized day name in: {expr!r}")
        start_dow = _DAY_NAMES[start_name]
        end_dow = _DAY_NAMES[end_name]
        nights = (end_dow - start_dow) % 7 or 7
        return list(_weekday_spans_in_month(y, mo, start_dow, nights))

    # YYYY/MM/DAYNAME — all occurrences of that weekday as one-night stays
    m = re.fullmatch(r"(\d{4})/(\d{2})/([A-Z]+)", upper)
    if m:
        y, mo, day_name = int(m.group(1)), int(m.group(2)), m.group(3)
        if day_name not in _DAY_NAMES:
            raise ValueError(f"Unrecognized day name in: {expr!r}")
        return list(_weekday_spans_in_month(y, mo, _DAY_NAMES[day_name], 1))

    raise ValueError(f"Unrecognized date expression: {expr!r}")


def _weekday_spans_in_month(
    year: int, month: int, start_weekday: int, nights: int
) -> Iterator[tuple[date, date]]:
    d = date(year, month, 1)
    days_ahead = (start_weekday - d.weekday()) % 7
    d += timedelta(days=days_ahead)
    while d.month == month:
        yield (d, d + timedelta(days=nights))
        d += timedelta(weeks=1)
