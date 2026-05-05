from __future__ import annotations
import asyncio
import uuid
from datetime import date, datetime, timezone

import httpx

from campsite.models import AvailableSite

BASE_URL = "https://camping.bcparks.ca"

# Attribute definition IDs discovered from docs/api-notes.md.
# filterData enumValues:[1] = "No" for both attributes.
# So: attribute present with value 1.0 → drive-in / not-double.
_ATTR_WALK_IN = -32764
_ATTR_DOUBLE = -32722


class BCParksAPI:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=30.0,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://camping.bcparks.ca/",
                "Accept": "application/json",
            },
        )
        self._cart_uid: str | None = None
        self._cart_tx_uid: str | None = None
        # Cached per-session data (rarely changes between polls)
        self._locations: dict[str, dict] | None = None
        self._resources: dict[str, dict[str, dict]] = {}  # locationId → {resourceId → resource}

    async def _ensure_cart(self) -> None:
        if self._cart_uid is not None:
            return
        resp = await self._client.get("/api/cart")
        resp.raise_for_status()
        data = resp.json()
        self._cart_uid = data["cartUid"]
        self._cart_tx_uid = data["newTransaction"]["cartTransactionUid"]

    async def _locations_data(self) -> dict[str, dict]:
        if self._locations is None:
            resp = await self._client.get("/api/resourceLocation")
            resp.raise_for_status()
            self._locations = {
                str(loc["resourceLocationId"]): loc
                for loc in resp.json()
            }
        return self._locations

    async def _root_map_id(self, campground_id: str) -> str:
        locs = await self._locations_data()
        loc = locs.get(campground_id)
        if loc is None:
            raise ValueError(
                f"Campground {campground_id!r} not found in /api/resourceLocation. "
                "Check your config park_id."
            )
        return str(loc["rootMapId"])

    async def _resources_for(self, campground_id: str) -> dict[str, dict]:
        if campground_id not in self._resources:
            resp = await self._client.get(
                "/api/resourcelocation/resources",
                params={"resourceLocationId": campground_id},
            )
            resp.raise_for_status()
            self._resources[campground_id] = resp.json()
        return self._resources[campground_id]

    async def _map_availability(self, map_id: str, check_in: date, check_out: date) -> dict:
        resp = await self._client.get(
            "/api/availability/map",
            params={
                "mapId": map_id,
                "bookingCategoryId": 0,
                "equipmentCategoryId": -32768,
                "subEquipmentCategoryId": -32768,
                "cartUid": self._cart_uid,
                "cartTransactionUid": self._cart_tx_uid,
                "bookingUid": str(uuid.uuid4()),
                "groupHoldUid": "",
                "startDate": check_in.isoformat(),
                "endDate": check_out.isoformat(),
                "getDailyAvailability": "false",
                "isReserving": "true",
                "filterData": "[]",
                "boatLength": 0,
                "boatDraft": 0,
                "boatWidth": 0,
                "peopleCapacityCategoryCounts": "[]",
                "numEquipment": 0,
                "seed": datetime.now(timezone.utc).isoformat(),
            },
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _attr_value(resource: dict, attr_id: int) -> float | None:
        for attr in resource.get("definedAttributes", []):
            if attr["attributeDefinitionId"] == attr_id:
                return attr.get("value")
        return None

    @staticmethod
    def _is_walkin(resource: dict) -> bool:
        # Attribute _ATTR_WALK_IN with value 1.0 means drive-in (NOT walk-in).
        # Absent or other value → treat as walk-in.
        val = BCParksAPI._attr_value(resource, _ATTR_WALK_IN)
        return val != 1.0

    @staticmethod
    def _is_double(resource: dict) -> bool:
        # Double sites have linkedResources (the paired site they must be booked with).
        return len(resource.get("linkedResources", [])) > 0

    async def get_availability(
        self,
        campground_id: str,
        check_in: date,
        check_out: date,
    ) -> list[AvailableSite]:
        """Return available sites for the campground and date range."""
        await self._ensure_cart()
        root_map_id = await self._root_map_id(campground_id)
        resources = await self._resources_for(campground_id)

        # Step 1: root map → find which sub-maps have any availability
        root_data = await self._map_availability(root_map_id, check_in, check_out)
        sub_map_ids = [
            map_id
            for map_id, avail_list in root_data.get("mapLinkAvailabilities", {}).items()
            if any(a > 0 for a in avail_list)
        ]

        if not sub_map_ids:
            return []

        # Step 2: fetch each sub-map in parallel
        sub_results = await asyncio.gather(
            *[self._map_availability(mid, check_in, check_out) for mid in sub_map_ids],
            return_exceptions=True,
        )

        sites: list[AvailableSite] = []
        for result in sub_results:
            if isinstance(result, Exception):
                continue
            for resource_id, avail_list in result.get("resourceAvailabilities", {}).items():
                if not any(a.get("availability") == 1 for a in avail_list):
                    continue
                resource = resources.get(resource_id)
                if resource is None:
                    continue
                sites.append(AvailableSite(
                    site_id=resource_id,
                    campground_id=campground_id,
                    is_walkin=self._is_walkin(resource),
                    is_double=self._is_double(resource),
                    check_in=check_in,
                    check_out=check_out,
                ))
        return sites

    async def close(self) -> None:
        await self._client.aclose()
