from __future__ import annotations
import httpx
from datetime import date
from campsite.models import AvailableSite


class BCParksAPI:
    """
    Client for the BC Parks internal REST API.

    BEFORE IMPLEMENTING: run `campsite discover` and read docs/api-notes.md.
    That file contains the real endpoint URLs, required headers, and response
    schemas discovered from a live browser session.

    Fill in get_availability() based on what you find there.
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient()

    async def get_availability(
        self,
        campground_id: str,
        check_in: date,
        check_out: date,
    ) -> list[AvailableSite]:
        """
        Return available sites for the given campground and date range.

        Implementation guide (fill in after campsite discover):
        1. Find the availability endpoint in docs/api-notes.md
        2. Note required query params (campground_id, dates, resource type, etc.)
        3. Note required headers (auth tokens, session cookies)
        4. Map response JSON fields to AvailableSite fields:
           - is_walkin: look for a field like "walkIn", "siteType", or "resourceLocationId"
           - is_double: look for a field like "double", "groupSite", or site name containing "double"
        """
        raise NotImplementedError(
            "Run 'campsite discover' first, then implement based on docs/api-notes.md"
        )

    async def close(self) -> None:
        await self._client.aclose()
