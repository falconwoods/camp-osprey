"""
Debug the "Review Reservation Details" page.
Run: .venv/bin/python debug_review_page.py

1. A browser opens at BC Parks
2. Navigate manually to the reservationmessages page (hold a site)
3. Click the green "Resume" button in the Playwright inspector to trigger inspection
"""
import json
from playwright.sync_api import sync_playwright

def inspect(page):
    print("\n" + "="*60)

    # ── All checkboxes ─────────────────────────────────────────────────────
    print("=== CHECKBOXES ===")
    for i, cb in enumerate(page.query_selector_all('input[type="checkbox"], mat-checkbox')):
        try:
            tag     = cb.evaluate("e => e.tagName.toLowerCase()")
            id_     = cb.get_attribute("id") or ""
            checked = cb.evaluate("e => e.checked ?? e.classList.contains('mat-mdc-checkbox-checked')")
            label   = cb.evaluate("""e => {
                const lbl = e.id ? document.querySelector('label[for="' + e.id + '"]') : null
                return (lbl || e.closest('label') || e.parentElement)?.textContent?.trim()?.substring(0,100) || ''
            }""")
            print(f"  [{i}] <{tag}> id={id_!r} checked={checked} label={label!r}")
        except Exception as e:
            print(f"  [{i}] err: {e}")

    # ── All buttons ────────────────────────────────────────────────────────
    print("\n=== BUTTONS ===")
    for i, b in enumerate(page.query_selector_all('button')):
        try:
            text = (b.inner_text() or "").strip().replace("\n"," ")[:80]
            if not text: continue
            disabled = b.get_attribute("disabled")
            aria     = b.get_attribute("aria-label") or ""
            cls      = (b.get_attribute("class") or "")[:60]
            print(f"  [{i}] {text!r}  disabled={disabled}  aria={aria!r}")
            print(f"       {cls}")
        except Exception as e:
            print(f"  [{i}] err: {e}")

    # ── Try clicking the checkbox via label ────────────────────────────────
    print("\n=== CLICK CHECKBOX VIA LABEL ===")
    result = page.evaluate("""() => {
        const cb = document.querySelector('input[type="checkbox"]')
        if (!cb) return { found: false }
        const lbl = cb.id ? document.querySelector('label[for="' + cb.id + '"]') : cb.closest('label')
        if (lbl) { lbl.click(); return { found: true, method: 'label', labelText: lbl.textContent.trim().substring(0,80) } }
        cb.click(); return { found: true, method: 'direct' }
    }""")
    print(f"  {json.dumps(result)}")
    page.wait_for_timeout(800)

    checked_after = page.evaluate("""() => {
        const cb = document.querySelector('input[type="checkbox"]')
        return cb ? cb.checked : null
    }""")
    print(f"  checked after: {checked_after}")

    # ── Confirm button state ───────────────────────────────────────────────
    print("\n=== CONFIRM BUTTON AFTER CHECKBOX ===")
    confirm = page.evaluate("""() => {
        const b = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.toLowerCase().includes('confirm reservation'))
        return b ? { text: b.textContent.trim(), disabled: b.disabled, cls: b.className.substring(0,60) } : null
    }""")
    print(f"  {json.dumps(confirm, indent=2)}")

    # ── Try clicking confirm ───────────────────────────────────────────────
    if confirm and not confirm.get("disabled"):
        print("\n=== CLICKING CONFIRM ===")
        clicked = page.evaluate("""() => {
            const b = Array.from(document.querySelectorAll('button'))
                .find(b => b.textContent.toLowerCase().includes('confirm reservation'))
            if (b) { b.click(); return true }
            return false
        }""")
        print(f"  clicked: {clicked}")

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=200)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto("https://camping.bcparks.ca", wait_until="networkidle")

        print("Navigate to the 'Review Reservation Details' page.")
        print("Then click Resume (▶) in the Playwright inspector panel.")
        page.pause()   # Opens inspector — user navigates, then clicks Resume

        inspect(page)

        print("\nDone. Click Resume again to close.")
        page.pause()
        browser.close()

if __name__ == "__main__":
    main()
