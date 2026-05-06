from __future__ import annotations
import asyncio
import json
import subprocess
from pathlib import Path

import click

from campsite.config import load_config


@click.group()
def cli():
    """BC Parks campsite scanner and auto-booker."""
    pass


@cli.command()
@click.option("--search", "-s", default="", help="Filter by name (case-insensitive substring).")
@click.option("--output", "-o", type=click.Path(), default=None,
              help="Save results to a JSON file.")
def parks(search: str, output: str | None) -> None:
    """List all BC Parks campgrounds with their IDs (for use in config.yaml)."""
    asyncio.run(_run_parks(search, output))


async def _run_parks(search: str, output: str | None) -> None:
    import httpx

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://camping.bcparks.ca/",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(base_url="https://camping.bcparks.ca", timeout=30.0, headers=headers) as client:
        resp = await client.get("/api/resourceLocation")
        resp.raise_for_status()
        locations = resp.json()

    # Filter by search term
    term = search.lower()
    matches = [
        loc for loc in locations
        if not term or any(
            term in v.get("shortName", "").lower() or term in v.get("fullName", "").lower()
            for v in loc.get("localizedValues", [{}])
        )
    ]

    if not matches:
        click.echo(f"No parks found matching {search!r}.")
        return

    # Console output — aligned columns
    col_w = 16
    click.echo(f"\n{'ID':<{col_w}}{'Short name':<30}Full name")
    click.echo("-" * 90)
    for loc in sorted(matches, key=lambda l: (l.get("localizedValues") or [{}])[0].get("shortName", "")):
        loc_id = str(loc["resourceLocationId"])
        vals = (loc.get("localizedValues") or [{}])[0]
        short = vals.get("shortName", "")
        full = vals.get("fullName", "")
        click.echo(f"{loc_id:<{col_w}}{short:<30}{full}")

    click.echo(f"\n{len(matches)} park(s) found.")

    # File output
    if output:
        records = []
        for loc in matches:
            vals = (loc.get("localizedValues") or [{}])[0]
            records.append({
                "park_id": str(loc["resourceLocationId"]),
                "short_name": vals.get("shortName", ""),
                "full_name": vals.get("fullName", ""),
                "root_map_id": str(loc.get("rootMapId", "")),
            })
        Path(output).write_text(json.dumps(records, indent=2))
        click.echo(f"Saved to {output}")


@cli.command()
@click.option(
    "--phase",
    type=click.Choice(["1", "2", "all"]),
    default="all",
    show_default=True,
    help="1 = API recording only, 2 = booking flow only, all = both",
)
def discover(phase: str):
    """
    Record BC Parks API calls and/or booking flow from a live browser session.

    Phase 1: Browse the site normally while network traffic is recorded
             → saves docs/api-notes.md

    Phase 2: Go through checkout while your clicks are recorded as Playwright code
             → saves docs/booking-flow.py
    """
    asyncio.run(_run_discover(phase))


async def _run_discover(phase: str = "all") -> None:
    from playwright.async_api import async_playwright

    docs = Path("docs")
    docs.mkdir(exist_ok=True)

    if phase in ("1", "all"):
        api_calls: list[dict] = []

        click.echo("=== Phase 1: API Discovery ===")
        click.echo("A browser window will open. Browse normally:")
        click.echo("  1. Search for a campground")
        click.echo("  2. Select dates and view available sites")
        click.echo("  3. Add a site to cart and go through checkout")
        click.echo("  4. Stop before entering payment")
        click.echo("\nAll API calls are recorded automatically.")
        click.echo("Press Enter here when you are done browsing...\n")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context()
            page = await context.new_page()

            response_bodies: dict[str, object] = {}

            async def on_response(response):
                if response.request.resource_type in ("xhr", "fetch"):
                    try:
                        body = await response.json()
                    except Exception:
                        try:
                            body = await response.text()
                        except Exception:
                            body = None
                    response_bodies[response.url] = body

            page.on("response", on_response)

            page.on(
                "request",
                lambda req: api_calls.append({
                    "url": req.url,
                    "method": req.method,
                    "resource_type": req.resource_type,
                    "headers": dict(req.headers),
                    "post_data": req.post_data,
                }) if req.resource_type in ("xhr", "fetch") else None,
            )

            await page.goto("https://camping.bcparks.ca")
            input()

            await context.close()
            await browser.close()

        for call in api_calls:
            call["response"] = response_bodies.get(call["url"])

        lines = [
            "# BC Parks API Notes\n\n",
            "_Generated by `campsite discover`. Edit to add implementation notes._\n\n",
        ]
        for call in api_calls:
            lines.append(f"## {call['method']} {call['url']}\n\n")
            if call.get("post_data"):
                lines.append(f"**Request body:**\n```\n{call['post_data']}\n```\n\n")
            if call.get("response"):
                body = call["response"]
                formatted = json.dumps(body, indent=2) if isinstance(body, (dict, list)) else str(body)
                lines.append(f"**Response:**\n```json\n{formatted[:2000]}\n```\n\n")

        notes_path = docs / "api-notes.md"
        notes_path.write_text("".join(lines))
        click.echo(f"API notes saved to {notes_path}")

    if phase in ("2", "all"):
        click.echo("\n=== Phase 2: Booking Flow Recording ===")
        click.echo("A new browser window will open.")
        click.echo("Go through the COMPLETE checkout including payment.")
        click.echo("Close the browser window when done.\n")

        flow_path = docs / "booking-flow.py"
        subprocess.run(
            ["playwright", "codegen", "--output", str(flow_path), "https://camping.bcparks.ca"],
            check=False,
        )
        click.echo(f"Booking flow saved to {flow_path}")

    click.echo("\nDiscovery complete.")
    if phase in ("1", "all"):
        click.echo("  Review docs/api-notes.md, then implement campsite/api.py.")
    if phase in ("2", "all"):
        click.echo("  Review docs/booking-flow.py, then implement campsite/booker.py.")


@cli.command()
@click.option("--file", "config_file", default="config.yaml", show_default=True,
              type=click.Path(exists=True), help="Path to config.yaml")
def check(config_file: str) -> None:
    """One-shot availability check across all configured campgrounds and dates. Does not book."""
    config = load_config(Path(config_file))
    asyncio.run(_run_check(config))


async def _run_check(config) -> None:
    from campsite.api import BCParksAPI
    from campsite.scanner import Scanner
    from campsite.models import AvailableSite

    api = BCParksAPI()
    try:
        scanner = Scanner(config, api)

        # Collect all available sites across all campgrounds and dates
        all_matches: list[AvailableSite] = []
        from campsite.models import parse_date_expression
        for campground in sorted(config.campgrounds, key=lambda c: c.priority):
            for expr in config.dates:
                for check_in, check_out in parse_date_expression(expr):
                    sites = await api.get_availability(
                        campground.park_id, check_in, check_out,
                        no_walkin=config.filters.no_walkin,
                        no_double=config.filters.no_double,
                    )
                    matches = scanner._apply_filters(sites)
                    all_matches.extend(matches)

        if not all_matches:
            click.echo("\nNo availability found for your campgrounds and dates.")
            return

        click.echo(f"\n{'─' * 60}")
        click.echo(f"  {len(all_matches)} site(s) available")
        click.echo(f"{'─' * 60}")
        for s in all_matches:
            nights = (s.check_out - s.check_in).days
            night_str = f"{nights} night{'s' if nights != 1 else ''}"
            click.echo(
                f"  {s.park_name or s.campground_id}"
                f"  │  {s.section_name or '—'}"
                f"  │  {s.site_name or s.site_id}"
                f"  │  {s.check_in} → {s.check_out} ({night_str})"
            )
        click.echo(f"{'─' * 60}")
    finally:
        await api.close()


@cli.command()
@click.option("--file", "config_file", default="config.yaml", show_default=True,
              type=click.Path(exists=True), help="Path to config.yaml")
@click.option("--hold", is_flag=True, default=False,
              help="On match, open browser and add site to cart (held 15 min) for manual checkout.")
def scan(config_file: str, hold: bool) -> None:
    """
    Start the polling loop. Scans for availability, books the first match, then stops.
    Runs until a campsite is successfully booked or you press Ctrl+C.
    """
    config = load_config(Path(config_file))
    asyncio.run(_run_scan(config, hold=hold))


async def _run_scan(config, hold: bool = False) -> None:
    from campsite.api import BCParksAPI
    from campsite.scanner import Scanner
    from campsite.booker import book_site
    from campsite.notifier import notify, NotificationEvent

    api = BCParksAPI()
    scanner = Scanner(config, api)

    click.echo(f"Scanning every {config.poll_interval_seconds}s. Press Ctrl+C to stop.")

    def _site_label(site) -> str:
        parts = [site.park_name or site.campground_id]
        if site.section_name:
            parts.append(site.section_name)
        parts.append(f"Site {site.site_name or site.site_id}")
        return " › ".join(parts)

    def _booking_url(site) -> str:
        pid = site.campground_id
        mid = site.map_id or pid
        return (
            f"https://camping.bcparks.ca/create-booking/results"
            f"?transactionLocationId={pid}&resourceLocationId={pid}&mapId={mid}"
            f"&searchTabGroupId=0&bookingCategoryId=0"
            f"&startDate={site.check_in}&endDate={site.check_out}"
            f"&nights={(site.check_out - site.check_in).days}"
            f"&isReserving=true&equipmentId=-32768&subEquipmentId=-32768"
        )

    async def on_match(site) -> bool:
        nights = (site.check_out - site.check_in).days
        night_str = f"{nights} night{'s' if nights != 1 else ''}"
        notify(
            NotificationEvent(
                title=f"Campsite Available — {site.park_name or site.campground_id}",
                message=(
                    f"{_site_label(site)}\n"
                    f"{site.check_in} → {site.check_out} ({night_str})"
                ),
                url=_booking_url(site),
            ),
            config.notifications,
        )
        if hold:
            click.echo("Holding site via cart API...")
            try:
                await api.login(config.credentials.bcparks_email, config.credentials.bcparks_password)
                checkout_url = await api.hold_site(site, config.credentials.party_size)
                notify(
                    NotificationEvent(
                        title=f"Site Held — Complete Payment Now",
                        message=(
                            f"{_site_label(site)}\n"
                            f"{site.check_in} → {site.check_out} ({night_str})\n"
                            f"Held for 15 minutes — log in to BC Parks and pay."
                        ),
                        url=checkout_url,
                    ),
                    config.notifications,
                )
                click.echo(f"  Held! Complete payment at: {checkout_url}")
            except Exception as e:
                click.echo(f"  Hold failed: {e}")
            return False  # keep scanning after a hold attempt

        if not config.auto_book:
            click.echo("auto_book is false — not booking. Continuing to scan.")
            return False

        click.echo("Attempting to book...")
        result = await book_site(site, config)

        if result.success:
            notify(
                NotificationEvent(
                    title=f"Booking Confirmed — {site.park_name or site.campground_id}",
                    message=(
                        f"{_site_label(site)}\n"
                        f"{site.check_in} → {site.check_out} ({night_str})\n"
                        f"Confirmation: {result.confirmation_number}"
                    ),
                    url="https://camping.bcparks.ca/my-bookings",
                ),
                config.notifications,
            )
            return True
        elif result.error_message and "payment" in result.error_message.lower():
            notify(
                NotificationEvent(
                    title="Payment Failed — Action Required",
                    message=(
                        f"{_site_label(site)}\n"
                        f"{result.error_message}\n"
                        "Scanning paused. Restart campsite scan to resume."
                    ),
                ),
                config.notifications,
            )
            raise SystemExit(1)
        else:
            notify(
                NotificationEvent(
                    title="Booking Failed",
                    message=(
                        f"{_site_label(site)}\n"
                        f"{result.error_message}\n"
                        "Trying next campground in priority list."
                    ),
                ),
                config.notifications,
            )
            return False

    try:
        await scanner.run_loop(on_match)
        click.echo("Done — campsite booked successfully.")
    except KeyboardInterrupt:
        click.echo("\nScan stopped.")
    finally:
        await api.close()


@cli.group("config")
def config_group() -> None:
    """Config management commands."""
    pass


@config_group.command("check")
@click.option("--file", "config_file", default="config.yaml", show_default=True,
              type=click.Path(exists=True), help="Path to config.yaml")
def config_check(config_file: str) -> None:
    """Validate config.yaml without running the scanner."""
    try:
        load_config(Path(config_file))
        click.echo("Config is valid.")
    except Exception as e:
        click.echo(f"Config error: {e}", err=True)
        raise SystemExit(1)
