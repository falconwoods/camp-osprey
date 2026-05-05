from __future__ import annotations
import asyncio
from datetime import date
from campsite.config import AppConfig
from campsite.models import AvailableSite, parse_date_expression
from campsite.api import BCParksAPI


class Scanner:
    def __init__(self, config: AppConfig, api: BCParksAPI) -> None:
        self._config = config
        self._api = api
        self._attempted: set[tuple[str, date, date]] = set()

    async def run_once(self) -> AvailableSite | None:
        """Check all campground × date pairs in priority order. Returns the first match."""
        date_ranges: list[tuple[date, date]] = []
        for expr in self._config.dates:
            date_ranges.extend(parse_date_expression(expr))

        for campground in sorted(self._config.campgrounds, key=lambda c: c.priority):
            for check_in, check_out in date_ranges:
                key = (campground.park_id, check_in, check_out)
                if key in self._attempted:
                    continue
                sites = await self._api.get_availability(campground.park_id, check_in, check_out)
                matches = self._apply_filters(sites)
                if matches:
                    return matches[0]
        return None

    def _apply_filters(self, sites: list[AvailableSite]) -> list[AvailableSite]:
        result = sites
        if self._config.filters.no_walkin:
            result = [s for s in result if not s.is_walkin]
        if self._config.filters.no_double:
            result = [s for s in result if not s.is_double]
        return result

    def mark_attempted(self, site: AvailableSite) -> None:
        self._attempted.add((site.campground_id, site.check_in, site.check_out))

    async def run_loop(self, on_match: callable) -> None:
        """Poll until on_match returns True (booking succeeded), then stop."""
        while True:
            match = await self.run_once()
            if match:
                success = await on_match(match)
                if success:
                    return
                self.mark_attempted(match)
            await asyncio.sleep(self._config.poll_interval_seconds)
