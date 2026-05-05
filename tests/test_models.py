from datetime import date
import pytest
from campsite.models import AvailableSite, BookingResult, parse_date_expression


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


def test_parse_specific_range():
    result = parse_date_expression("2026/06/20-2026/06/23")
    assert result == [(date(2026, 6, 20), date(2026, 6, 23))]


def test_parse_shorthand_range_same_month():
    result = parse_date_expression("2026/07/05-07")
    assert result == [(date(2026, 7, 5), date(2026, 7, 7))]


def test_parse_single_night():
    result = parse_date_expression("2026/07/05")
    assert result == [(date(2026, 7, 5), date(2026, 7, 6))]


def test_parse_dayname_range_full():
    # 2026/07/FRIDAY-SUNDAY → all Fri→Sun spans in July 2026
    # Fridays in July 2026: Jul 3, 10, 17, 24, 31
    result = parse_date_expression("2026/07/FRIDAY-SUNDAY")
    assert result == [
        (date(2026, 7, 3), date(2026, 7, 5)),
        (date(2026, 7, 10), date(2026, 7, 12)),
        (date(2026, 7, 17), date(2026, 7, 19)),
        (date(2026, 7, 24), date(2026, 7, 26)),
        (date(2026, 7, 31), date(2026, 8, 2)),
    ]


def test_parse_dayname_range_abbreviated():
    result = parse_date_expression("2026/07/FRI-SUN")
    assert result == parse_date_expression("2026/07/FRIDAY-SUNDAY")


def test_parse_single_dayname():
    # 2026/07/FRI → all Fridays in July as one-night stays (Fri→Sat)
    result = parse_date_expression("2026/07/FRI")
    assert result == [
        (date(2026, 7, 3), date(2026, 7, 4)),
        (date(2026, 7, 10), date(2026, 7, 11)),
        (date(2026, 7, 17), date(2026, 7, 18)),
        (date(2026, 7, 24), date(2026, 7, 25)),
        (date(2026, 7, 31), date(2026, 8, 1)),
    ]


def test_parse_dayname_case_insensitive():
    assert parse_date_expression("2026/07/fri") == parse_date_expression("2026/07/FRI")


def test_parse_invalid_expression():
    with pytest.raises(ValueError, match="Unrecognized date expression"):
        parse_date_expression("not-a-date")
