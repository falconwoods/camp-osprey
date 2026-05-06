from datetime import date
from unittest.mock import AsyncMock
import pytest
from campsite.models import AvailableSite
from campsite.config import (
    AppConfig, CampgroundConfig, FiltersConfig,
    CredentialsConfig, PaymentConfig,
)
from campsite.scanner import Scanner


def _make_site(campground_id="c1", is_walkin=False, is_double=False) -> AvailableSite:
    return AvailableSite(
        site_id="s1",
        campground_id=campground_id,
        is_walkin=is_walkin,
        is_double=is_double,
        check_in=date(2026, 7, 5),
        check_out=date(2026, 7, 6),
    )


def _make_config(campgrounds=None, dates=None, filters=None) -> AppConfig:
    return AppConfig(
        poll_interval_seconds=1,
        campgrounds=campgrounds or [CampgroundConfig(name="A", park_id="c1", priority=1)],
        dates=dates or ["2026/07/05"],
        filters=filters or FiltersConfig(),
        credentials=CredentialsConfig(
            bcparks_email="e@e.com", bcparks_password="pw",
            party_size=2, vehicle_plate="X1",
        ),
        payment=PaymentConfig(
            card_number="4111", card_expiry="12/28", card_cvv="123", name_on_card="Test"
        ),
    )


async def test_run_once_returns_match():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site()]
    scanner = Scanner(_make_config(), api)
    results = await scanner.run_once()
    assert len(results) == 1
    assert results[0].campground_id == "c1"


async def test_run_once_returns_empty_when_none():
    api = AsyncMock()
    api.get_availability.return_value = []
    scanner = Scanner(_make_config(), api)
    results = await scanner.run_once()
    assert results == []


async def test_filter_walkin_excluded():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site(is_walkin=True)]
    config = _make_config(filters=FiltersConfig(no_walkin=True, no_double=False))
    scanner = Scanner(config, api)
    assert await scanner.run_once() == []


async def test_filter_double_excluded():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site(is_double=True)]
    config = _make_config(filters=FiltersConfig(no_walkin=False, no_double=True))
    scanner = Scanner(config, api)
    assert await scanner.run_once() == []


async def test_priority_order():
    calls = []

    async def fake_availability(campground_id, check_in, check_out, no_walkin=False, no_double=False):
        calls.append(campground_id)
        return [_make_site(campground_id=campground_id)] if campground_id == "c2" else []

    api = AsyncMock()
    api.get_availability.side_effect = fake_availability
    config = _make_config(campgrounds=[
        CampgroundConfig(name="A", park_id="c1", priority=1),
        CampgroundConfig(name="B", park_id="c2", priority=2),
    ])
    scanner = Scanner(config, api)
    results = await scanner.run_once()
    assert calls[0] == "c1"
    assert results[0].campground_id == "c2"


async def test_deduplication_skips_attempted():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site()]
    scanner = Scanner(_make_config(), api)

    first = (await scanner.run_once())[0]
    assert first is not None
    scanner.mark_attempted(first)

    second = await scanner.run_once()
    assert second == []
