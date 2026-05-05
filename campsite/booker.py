from __future__ import annotations
from campsite.models import AvailableSite, BookingResult
from campsite.config import AppConfig


async def book_site(site: AvailableSite, config: AppConfig) -> BookingResult:
    """
    Book the given site using the Playwright flow from docs/booking-flow.py.

    BEFORE IMPLEMENTING: run `campsite discover` and study docs/booking-flow.py.
    Replace the NotImplementedError with the actual Playwright automation steps.

    Returns BookingResult with success=True and confirmation_number on success.
    Returns BookingResult with success=False and error_message if the site was taken.
    """
    raise NotImplementedError(
        "Run 'campsite discover' first, then implement based on docs/booking-flow.py"
    )
