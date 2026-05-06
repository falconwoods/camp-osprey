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

    async def run_once(self) -> list[AvailableSite]:
        """Check all campground × date pairs in priority order. Returns all matches."""
        date_ranges: list[tuple[date, date]] = []
        for expr in self._config.dates:
            date_ranges.extend(parse_date_expression(expr))

        all_matches: list[AvailableSite] = []
        for campground in sorted(self._config.campgrounds, key=lambda c: c.priority):
            for check_in, check_out in date_ranges:
                key = (campground.park_id, check_in, check_out)
                if key in self._attempted:
                    continue
                sites = await self._api.get_availability(
                    campground.park_id, check_in, check_out,
                    no_walkin=self._config.filters.no_walkin,
                    no_double=self._config.filters.no_double,
                )
                all_matches.extend(self._apply_filters(sites))
        return all_matches

    def _apply_filters(self, sites: list[AvailableSite]) -> list[AvailableSite]:
        result = sites
        if self._config.filters.no_walkin:
            skipped = [s for s in result if s.is_walkin]
            if skipped:
                print(f"  skipped {len(skipped)} walk-in site(s): {[s.site_id for s in skipped]}", flush=True)
            result = [s for s in result if not s.is_walkin]
        if self._config.filters.no_double:
            skipped = [s for s in result if s.is_double]
            if skipped:
                print(f"  skipped {len(skipped)} double site(s): {[s.site_id for s in skipped]}", flush=True)
            result = [s for s in result if not s.is_double]
        return result

    def mark_attempted(self, site: AvailableSite) -> None:
        self._attempted.add((site.campground_id, site.check_in, site.check_out))

    async def run_loop(self, on_match: callable, first_only: bool = False) -> None:
        """Poll until on_match returns True (booking/hold succeeded), then stop.

        first_only=True: only call on_match for the first available site per cycle
        (use for --hold to avoid sending multiple cart commits in one scan cycle).
        """
        while True:
            matches = await self.run_once()
            for match in (matches[:1] if first_only else matches):
                success = await on_match(match)
                if success:
                    return
                self.mark_attempted(match)
            await asyncio.sleep(self._config.poll_interval_seconds)
