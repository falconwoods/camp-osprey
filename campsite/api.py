from __future__ import annotations
import asyncio
import copy
import json
import uuid
from datetime import date, datetime, timezone

import httpx

from campsite.models import AvailableSite

BASE_URL = "https://camping.bcparks.ca"
_CONCURRENCY = 10  # max parallel site-availability calls


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
        self._terminal_location_id: int = -2147483590
        self._cart_data: dict | None = None  # full cart JSON, kept in sync with _cart_uid
        self._locations: dict[str, dict] | None = None
        self._resources: dict[str, dict[str, dict]] = {}
        # {locationId → {resourceId → (section_name, is_walkin)}}
        self._sections: dict[str, dict[str, tuple[str, bool]]] = {}

    # ── Session / cache ────────────────────────────────────────────────────

    async def login(self, email: str, password: str) -> None:
        """Authenticate with BC Parks account so the cart is tied to the account."""
        # GET /api/cart sets the XSRF-TOKEN cookie required for POST requests
        await self._ensure_cart()
        xsrf = self._client.cookies.get("XSRF-TOKEN", "")
        resp = await self._client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
            headers={"X-XSRF-TOKEN": xsrf},
        )
        resp.raise_for_status()
        # Reset cached cart so next call fetches the authenticated one
        self._cart_uid = None
        self._cart_tx_uid = None
        self._cart_data = None

    async def _ensure_cart(self) -> None:
        if self._cart_uid is not None:
            return
        print("→ Initializing cart session...", flush=True)
        resp = await self._client.get("/api/cart")
        resp.raise_for_status()
        self._cart_data = resp.json()
        self._cart_uid = self._cart_data["cartUid"]
        tx = self._cart_data["newTransaction"]
        self._cart_tx_uid = tx["cartTransactionUid"]
        self._terminal_location_id = tx.get("terminalLocationId", -2147483590)
        print(f"  cart: {self._cart_uid}", flush=True)

    async def _locations_data(self) -> dict[str, dict]:
        if self._locations is None:
            print("→ Fetching campground list...", flush=True)
            resp = await self._client.get("/api/resourceLocation")
            resp.raise_for_status()
            self._locations = {str(loc["resourceLocationId"]): loc for loc in resp.json()}
            print(f"  {len(self._locations)} locations loaded", flush=True)
        return self._locations

    async def _resources_for(self, campground_id: str) -> dict[str, dict]:
        if campground_id not in self._resources:
            print(f"→ Fetching site list for {campground_id}...", flush=True)
            resp = await self._client.get(
                "/api/resourcelocation/resources",
                params={"resourceLocationId": campground_id},
            )
            resp.raise_for_status()
            self._resources[campground_id] = resp.json()
            print(f"  {len(self._resources[campground_id])} sites loaded", flush=True)
        return self._resources[campground_id]

    async def _sections_for(self, campground_id: str) -> dict[str, tuple[str, bool, str]]:
        """Returns {resourceId: (section_name, is_walkin, map_id)} from the maps data."""
        if campground_id not in self._sections:
            resp = await self._client.get("/api/maps", params={"resourceLocationId": campground_id})
            resp.raise_for_status()
            sections: dict[str, tuple[str, bool, str]] = {}
            for m in resp.json():
                map_id = str(m["mapId"])
                vals = m.get("localizedValues") or []
                title = vals[0].get("title", "") if vals else ""
                is_walkin = "walk" in title.lower()
                for mr in m.get("mapResources", []):
                    sections[str(mr["resourceId"])] = (title, is_walkin, map_id)
            self._sections[campground_id] = sections
        return self._sections[campground_id]

    # ── Availability check ─────────────────────────────────────────────────

    async def _daily_availability(
        self, resource_id: str, check_in: date, check_out: date, filter_data: str = "[]"
    ) -> list[dict]:
        resp = await self._client.get(
            "/api/availability/resourcedailyavailability",
            params={
                "cartUid": self._cart_uid,
                "resourceId": resource_id,
                "bookingCategoryId": 0,
                "startDate": check_in.isoformat(),
                "endDate": check_out.isoformat(),
                "isReserving": "true",
                "equipmentCategoryId": -32768,
                "subEquipmentCategoryId": -32768,
                "boatLength": 0,
                "boatDraft": 0,
                "boatWidth": 0,
                "peopleCapacityCategoryCounts": "[]",
                "numEquipment": 0,
                "filterData": filter_data,
                "groupHoldUid": "",
                "bookingUid": str(uuid.uuid4()),
            },
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _nights_available(daily: list[dict], num_nights: int) -> bool:
        # availability=0 means FREE, availability=1 means OCCUPIED (confirmed by live API).
        # Only check-in nights matter; the check-out day entry is ignored.
        return all(entry.get("availability", 1) == 0 for entry in daily[:num_nights])

    @staticmethod
    def _site_flags(resource: dict, section_is_walkin: bool) -> tuple[bool, bool]:
        """Return (is_walkin, is_double) using section membership, description, and attributes."""
        desc = ((resource.get("localizedValues") or [{}])[0].get("description") or "").lower()
        attrs = {a.get("attributeDefinitionId") for a in (resource.get("attributes") or [])}
        # attributeDefinitionId -32764 = Walk-in, -32722 = Double Site
        is_walkin = section_is_walkin or "first-come" in desc or "first come" in desc or -32764 in attrs
        is_double = "double site" in desc or -32722 in attrs or len(resource.get("linkedResources", [])) > 0
        return is_walkin, is_double

    @staticmethod
    def build_filter_data(no_walkin: bool, no_double: bool) -> str:
        filters = []
        if no_walkin:
            filters.append({"attributeDefinitionId": -32764, "attributeType": 0,
                            "enumValues": [1], "attributeDefinitionDecimalValue": 0, "filterStrategy": 1})
        if no_double:
            filters.append({"attributeDefinitionId": -32722, "attributeType": 0,
                            "enumValues": [1], "attributeDefinitionDecimalValue": 0, "filterStrategy": 1})
        return json.dumps(filters)

    # ── Public API ─────────────────────────────────────────────────────────

    async def get_availability(
        self,
        campground_id: str,
        check_in: date,
        check_out: date,
        no_walkin: bool = False,
        no_double: bool = False,
    ) -> list[AvailableSite]:
        """Return available sites for the campground and date range."""
        await self._ensure_cart()
        locs, resources, sections = await asyncio.gather(
            self._locations_data(),
            self._resources_for(campground_id),
            self._sections_for(campground_id),
        )

        loc_vals = (locs.get(campground_id, {}).get("localizedValues") or [{}])[0]
        park_name = loc_vals.get("shortName", campground_id)
        num_nights = (check_out - check_in).days

        print(f"→ Checking availability: {park_name} | {check_in} → {check_out}", flush=True)

        # Build candidates: pre-filter by walk-in / double using section + description
        candidates = []
        for resource_id, resource in resources.items():
            section_name, section_is_walkin, map_id = sections.get(resource_id, ("", False, ""))
            is_walkin, is_double = self._site_flags(resource, section_is_walkin)
            if no_walkin and is_walkin:
                continue
            if no_double and is_double:
                continue
            res_vals = (resource.get("localizedValues") or [{}])[0]
            site_name = res_vals.get("name", resource_id)
            candidates.append((resource_id, section_name, is_walkin, is_double, site_name, map_id))

        semaphore = asyncio.Semaphore(_CONCURRENCY)

        async def check_one(resource_id, section_name, is_walkin, is_double, site_name, map_id):
            async with semaphore:
                try:
                    daily = await self._daily_availability(resource_id, check_in, check_out)
                except Exception:
                    return None
            if not self._nights_available(daily, num_nights):
                return None
            return AvailableSite(
                site_id=resource_id,
                campground_id=campground_id,
                is_walkin=is_walkin,
                is_double=is_double,
                check_in=check_in,
                check_out=check_out,
                park_name=park_name,
                section_name=section_name,
                site_name=site_name,
                map_id=map_id,
            )

        results = await asyncio.gather(*[check_one(*c) for c in candidates])
        sites = [r for r in results if r is not None]
        print(f"  {len(sites)} site(s) available", flush=True)
        return sites

    async def hold_site(self, site: AvailableSite, party_size: int = 1) -> str:
        """
        Add site to cart via API (isCompleted=false) to hold it for 15 minutes.
        The cart is tied to the logged-in account — the user can open BC Parks,
        log in, and complete payment. Returns the checkout URL.
        """
        await self._ensure_cart()
        cart = copy.deepcopy(self._cart_data)  # use the same cart that _ensure_cart fetched

        booking_uid = str(uuid.uuid4())
        blocker_uid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        cart["bookings"] = [{
                    "bookingUid": booking_uid,
                    "cartUid": self._cart_uid,
                    "bookingCategoryId": 0,
                    "bookingModel": 0,
                    "newVersion": {
                        "cartTransactionUid": self._cart_tx_uid,
                        "bookingMembers": [],
                        "bookingVehicles": [],
                        "bookingBoats": [],
                        "bookingCapacityCategoryCounts": [
                            {"capacityCategoryId": -32767, "subCapacityCategoryId": -32768,
                             "count": party_size, "isAdult": True},
                            {"capacityCategoryId": -32767, "subCapacityCategoryId": -32767,
                             "count": 0, "isAdult": True},
                            {"capacityCategoryId": -32767, "subCapacityCategoryId": -32766,
                             "count": 0, "isAdult": False},
                            {"capacityCategoryId": -32767, "subCapacityCategoryId": -32765,
                             "count": 0, "isAdult": False},
                        ],
                        "rateCategoryId": -32768,
                        "resourceBlockerUids": [blocker_uid],
                        "resourceNonSpecificBlockerUids": [],
                        "resourceZoneBlockerUids": [],
                        "resourceZoneEntryBlockerUids": [],
                        "startDate": site.check_in.isoformat(),
                        "endDate": site.check_out.isoformat(),
                        "releasePersonalInformation": False,
                        "equipmentCategoryId": -32768,
                        "subEquipmentCategoryId": -32768,
                        "occupant": {
                            "contact": {"email": "", "contactName": "",
                                        "phoneNumberCountryCode": None, "phoneNumber": ""},
                            "address": {},
                            "allowMarketing": False,
                            "phoneNumbers": {},
                            "preferredCultureName": "en-CA",
                            "firstName": "",
                            "lastName": "",
                        },
                        "requiresCheckout": False,
                        "bookingStatus": 0,
                        "completedDate": now,
                        "arrivalComment": "",
                        "entryPointResourceId": None,
                        "exitPointResourceId": None,
                        "bookingSurcharges": [],
                        "consentToRelease": False,
                        "equipmentDescription": "",
                        "groupHoldUid": "",
                        "organizationName": "",
                        "passExpiryDate": None,
                        "passNumber": "",
                        "resourceLocationId": int(site.campground_id),
                        "checkInTime": None,
                        "checkOutTime": None,
                        "deferredPayment": False,
                    },
                    "createTransactionUid": self._cart_tx_uid,
                    "currentVersion": None,
                    "history": [],
                    "drafts": [],
                    "referenceNumberPostfix": "",
                }]
        cart["resourceBlockers"] = [{
            "blockerType": 0,
            "cartUid": self._cart_uid,
            "resourceBlockerUid": blocker_uid,
            "bookingUid": booking_uid,
            "groupHoldUid": "",
            "isReservation": True,
            "newVersion": {
                "creationDate": now,
                "cartTransactionUid": self._cart_tx_uid,
                "startDate": site.check_in.isoformat(),
                "endDate": site.check_out.isoformat(),
                "resourceId": int(site.site_id),
                "resourceLocationId": int(site.campground_id),
                "status": 0,
            },
        }]

        xsrf = self._client.cookies.get("XSRF-TOKEN", "")

        # Step 1: hold the site (server calculates fees and line items)
        resp = await self._client.post(
            "/api/cart/commit",
            params={"isCompleted": "false", "isSelfCheckIn": "false"},
            json={"cart": cart},
            headers={"X-XSRF-TOKEN": xsrf},
        )
        if not resp.is_success:
            try:
                detail = resp.json().get("messageKey", resp.text)
            except Exception:
                detail = resp.text
            raise RuntimeError(f"Cart commit failed ({resp.status_code}): {detail}")

        # Step 2: fetch updated cart (server has now added line items and fees)
        cart_resp = await self._client.get("/api/cart")
        cart_resp.raise_for_status()
        confirmed_cart = cart_resp.json()

        # Step 3: second commit — "Confirm reservation details"
        resp2 = await self._client.post(
            "/api/cart/commit",
            params={"isCompleted": "false", "isSelfCheckIn": "false"},
            json={"cart": confirmed_cart},
            headers={"X-XSRF-TOKEN": xsrf},
        )
        if not resp2.is_success:
            try:
                detail = resp2.json().get("messageKey", resp2.text)
            except Exception:
                detail = resp2.text
            raise RuntimeError(f"Confirmation commit failed ({resp2.status_code}): {detail}")

        # Transfer our API session cookies to a Playwright browser so the user
        # sees their held cart and can complete payment without logging in again.
        checkout_url = "https://camping.bcparks.ca/create-booking/reservationmessages"
        cookies = [
            {"name": name, "value": value, "domain": "camping.bcparks.ca", "path": "/"}
            for name, value in self._client.cookies.items()
        ]
        await self._open_checkout_browser(checkout_url, cookies)
        return checkout_url

    async def _open_checkout_browser(self, url: str, cookies: list[dict]) -> None:
        """Open a visible browser with the API session cookies so the user can pay."""
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context()
            await context.add_cookies(cookies)
            page = await context.new_page()
            await page.goto(url)
            print("  Browser opened — complete payment and close the window.", flush=True)
            # Wait until the user closes the browser
            await page.wait_for_event("close", timeout=0)
            await browser.close()

    async def close(self) -> None:
        await self._client.aclose()
