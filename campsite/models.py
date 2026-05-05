from __future__ import annotations
from dataclasses import dataclass
from datetime import date


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
