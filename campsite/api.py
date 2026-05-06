from __future__ import annotations
import asyncio
import uuid
from datetime import date, datetime, timezone

import httpx

from campsite.models import AvailableSite

BASE_URL = "https://camping.bcparks.ca"


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
        self._locations: dict[str, dict] | None = None
        self._resources: dict[str, dict[str, dict]] = {}
        self._map_titles: dict[str, dict[str, str]] = {}  # locationId → {mapId → title}

    async def _ensure_cart(self) -> None:
        if self._cart_uid is not None:
            return
        print("→ Initializing cart session...", flush=True)
        resp = await self._client.get("/api/cart")
        resp.raise_for_status()
        data = resp.json()
        self._cart_uid = data["cartUid"]
        self._cart_tx_uid = data["newTransaction"]["cartTransactionUid"]
        print(f"  cart: {self._cart_uid}", flush=True)

    async def _locations_data(self) -> dict[str, dict]:
        if self._locations is None:
            print("→ Fetching campground list...", flush=True)
            resp = await self._client.get("/api/resourceLocation")
            resp.raise_for_status()
            self._locations = {
                str(loc["resourceLocationId"]): loc
                for loc in resp.json()
            }
            print(f"  {len(self._locations)} locations loaded", flush=True)
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
            print(f"→ Fetching site list for campground {campground_id}...", flush=True)
            resp = await self._client.get(
                "/api/resourcelocation/resources",
                params={"resourceLocationId": campground_id},
            )
            resp.raise_for_status()
            self._resources[campground_id] = resp.json()
            print(f"  {len(self._resources[campground_id])} sites loaded", flush=True)
        return self._resources[campground_id]

    async def _map_titles_for(self, campground_id: str) -> dict[str, str]:
        """Returns {mapId: title} for all sub-maps of this campground."""
        if campground_id not in self._map_titles:
            resp = await self._client.get(
                "/api/maps",
                params={"resourceLocationId": campground_id},
            )
            resp.raise_for_status()
            titles: dict[str, str] = {}
            for m in resp.json():
                map_id = str(m["mapId"])
                vals = m.get("localizedValues") or []
                title = vals[0].get("title", "") if vals else ""
                titles[map_id] = title
            self._map_titles[campground_id] = titles
        return self._map_titles[campground_id]

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
    def _is_double(resource: dict) -> bool:
        return len(resource.get("linkedResources", [])) > 0

    async def _collect_sites(
        self,
        map_id: str,
        check_in: date,
        check_out: date,
        resources: dict,
        map_titles: dict[str, str],
        visited: set[str],
        campground_id: str,
        park_name: str,
        section_is_walkin: bool = False,
        parent_section: str = "",
    ) -> list[AvailableSite]:
        """Recursively traverse map hierarchy and collect all available sites."""
        if map_id in visited:
            return []
        visited.add(map_id)

        title = map_titles.get(map_id, "")
        section_name = title or parent_section
        is_walkin_section = section_is_walkin or "walk" in title.lower()

        data = await self._map_availability(map_id, check_in, check_out)
        sites: list[AvailableSite] = []

        for resource_id, avail_list in data.get("resourceAvailabilities", {}).items():
            if not any(a.get("availability") == 1 for a in avail_list):
                continue
            resource = resources.get(resource_id)
            if resource is None:
                continue
            res_vals = (resource.get("localizedValues") or [{}])[0]
            site_name = res_vals.get("name", resource_id)
            sites.append(AvailableSite(
                site_id=resource_id,
                campground_id=campground_id,
                is_walkin=is_walkin_section,
                is_double=self._is_double(resource),
                check_in=check_in,
                check_out=check_out,
                park_name=park_name,
                section_name=section_name,
                site_name=site_name,
            ))

        sub_map_ids = [mid for mid in data.get("mapLinkAvailabilities", {}) if mid not in visited]
        if sub_map_ids:
            sub_results = await asyncio.gather(
                *[self._collect_sites(
                    mid, check_in, check_out, resources, map_titles,
                    visited, campground_id, park_name, is_walkin_section, section_name,
                  ) for mid in sub_map_ids],
                return_exceptions=True,
            )
            for result in sub_results:
                if not isinstance(result, Exception):
                    sites.extend(result)

        return sites

    async def get_availability(
        self,
        campground_id: str,
        check_in: date,
        check_out: date,
    ) -> list[AvailableSite]:
        """Return available sites for the campground and date range."""
        await self._ensure_cart()
        locs, resources, map_titles = await asyncio.gather(
            self._locations_data(),
            self._resources_for(campground_id),
            self._map_titles_for(campground_id),
        )
        root_map_id = await self._root_map_id(campground_id)
        loc = locs.get(campground_id, {})
        loc_vals = (loc.get("localizedValues") or [{}])[0]
        park_name = loc_vals.get("shortName", campground_id)

        print(f"→ Checking availability: {park_name} | {check_in} → {check_out}", flush=True)
        sites = await self._collect_sites(
            root_map_id, check_in, check_out, resources, map_titles, set(), campground_id, park_name
        )
        print(f"  {len(sites)} site(s) available before filters", flush=True)
        return sites

    async def close(self) -> None:
        await self._client.aclose()
