from datetime import date
from campsite.models import AvailableSite, BookingResult


def test_available_site_fields():
    site = AvailableSite(
        site_id="s1",
        campground_id="c1",
        is_walkin=False,
        is_double=False,
        check_in=date(2026, 7, 3),
        check_out=date(2026, 7, 5),
    )
    assert site.site_id == "s1"
    assert site.is_walkin is False


def test_booking_result_success():
    site = AvailableSite(
        site_id="s1", campground_id="c1", is_walkin=False, is_double=False,
        check_in=date(2026, 7, 3), check_out=date(2026, 7, 5),
    )
    result = BookingResult(success=True, site=site, confirmation_number="BC-12345")
    assert result.success is True
    assert result.confirmation_number == "BC-12345"


def test_booking_result_failure():
    result = BookingResult(success=False, error_message="Site taken")
    assert result.success is False
    assert result.site is None
