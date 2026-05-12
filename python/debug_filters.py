"""
Debug BC Parks filter dialog structure for multiple parks.
Run: .venv/bin/python debug_filters.py
"""
import json
from playwright.sync_api import sync_playwright

PARKS = ["Porteau Cove", "Rolley Lake", "Alice Lake", "Golden Ears"]
CHECK_IN  = "2026-06-20"
CHECK_OUT = "2026-06-22"
NIGHTS    = "2"

def get_park_params(page, park_name: str) -> dict | None:
    resp = page.request.get("https://camping.bcparks.ca/api/resourceLocation")
    locs = resp.json()
    term = park_name.lower()
    for loc in locs:
        vals = (loc.get("localizedValues") or [{}])[0]
        short = vals.get("shortName", "")
        full  = vals.get("fullName", "")
        if term in short.lower() or term in full.lower():
            return {
                "resourceLocationId":    str(loc["resourceLocationId"]),
                "transactionLocationId": str(loc.get("transactionLocationId", loc["resourceLocationId"])),
                "rootMapId":             str(loc.get("rootMapId", loc["resourceLocationId"])),
                "name": short or full,
            }
    return None


def inspect_filters(page, park_name: str) -> dict:
    """Open filter dialog and capture everything about its structure."""
    filter_btn = page.query_selector("#filters-button-desktop")
    if not filter_btn:
        return {"error": "no filter button"}
    filter_btn.click()
    page.wait_for_timeout(1500)

    # Grab full overlay HTML
    overlay = page.query_selector(".cdk-overlay-container")
    html = overlay.inner_html() if overlay else ""

    # Dump all text nodes and class info for every element inside the overlay
    elements = []
    if overlay:
        for el in overlay.query_selector_all("*"):
            try:
                tag   = el.evaluate("e => e.tagName.toLowerCase()")
                cls   = (el.get_attribute("class") or "").strip()
                text  = (el.inner_text() or "").strip().replace("\n", " ")[:100]
                if text or "filter" in cls.lower() or "radio" in tag:
                    elements.append({"tag": tag, "class": cls, "text": text})
            except Exception:
                pass

    # Save full HTML for manual inspection
    html_path = f"/tmp/filter_{park_name.replace(' ', '_')}.html"
    with open(html_path, "w") as f:
        f.write(html)

    page.keyboard.press("Escape")
    page.wait_for_timeout(800)
    return {"html_path": html_path, "elements": elements}


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=150)
        ctx = browser.new_context()
        page = ctx.new_page()

        page.goto("https://camping.bcparks.ca", wait_until="networkidle")
        page.wait_for_timeout(1000)

        results = {}
        for park_name in PARKS:
            print(f"\n{'='*60}\nPark: {park_name}")
            params = get_park_params(page, park_name)
            if not params:
                print(f"  !! Not found in API")
                results[park_name] = {"error": "not found"}
                continue

            print(f"  id={params['resourceLocationId']}  mapId={params['rootMapId']}")
            url = (
                "https://camping.bcparks.ca/create-booking/results"
                f"?transactionLocationId={params['transactionLocationId']}"
                f"&resourceLocationId={params['resourceLocationId']}"
                f"&mapId={params['rootMapId']}"
                f"&searchTabGroupId=0&bookingCategoryId=0"
                f"&startDate={CHECK_IN}&endDate={CHECK_OUT}&nights={NIGHTS}"
                f"&isReserving=true&equipmentId=-32768&subEquipmentId=-32768"
            )
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(3000)

            try:
                page.wait_for_selector("#filters-button-desktop", timeout=10000)
            except Exception:
                print("  !! Filter button never appeared")
                results[park_name] = {"error": "page didn't load"}
                continue

            data = inspect_filters(page, park_name)
            results[park_name] = data
            print(f"  HTML saved → {data.get('html_path')}")

            # Print elements that look like filter groups or radio buttons
            print("  Relevant elements:")
            for el in data.get("elements", []):
                if any(k in el["class"].lower() for k in ["filter", "radio", "attribute"]) or el["tag"] in ["mat-radio-button", "mat-radio-group"]:
                    print(f"    tag={el['tag']:<30} class={el['class'][:60]:<60} text={el['text']!r}")

        browser.close()


if __name__ == "__main__":
    main()
