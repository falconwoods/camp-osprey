// Content script — injected on all camping.bcparks.ca pages

interface TargetSite {
  resourceId: string
  siteName: string
  sectionName: string
  parkName: string
  tripId: string
  mode: 'hold' | 'autopay'
  setAt: number
}

// content scripts can only access chrome.storage.local, not session
chrome.storage.local.get('campSnaperTarget', (result: Record<string, unknown>) => {
  if (chrome.runtime.lastError) return
  const target = result?.['campSnaperTarget'] as TargetSite | undefined
  if (!target) return
  if (Date.now() - target.setAt > 5 * 60 * 1000) return  // ignore stale

  const url = window.location.href
  if (url.includes('/create-booking/results')) {
    handleResultsPage(target)
  } else if (url.includes('reservationmessages') || url.includes('payment') || url.includes('checkout')) {
    if (target.mode === 'autopay') runCheckout(target.tripId)
  }
})

// ── Banner (fixed bottom so it never covers BC Parks nav/cart) ─────────────

function injectBanner(html: string): HTMLElement {
  const existing = document.getElementById('campsniper-banner')
  if (existing) existing.remove()
  const banner = document.createElement('div')
  banner.id = 'campsniper-banner'
  banner.innerHTML = html
  Object.assign(banner.style, {
    position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '999999',
    background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif',
    fontSize: '13px', padding: '12px 20px', display: 'flex', alignItems: 'center',
    gap: '12px', boxShadow: '0 -2px 12px rgba(0,0,0,0.4)',
    borderTop: '1px solid #1e293b',
  })
  document.body.appendChild(banner)  // append so it's at the bottom of the body
  return banner
}

// ── Results page ───────────────────────────────────────────────────────────

async function handleResultsPage(target: TargetSite): Promise<void> {
  injectBanner(`
    <span style="font-size:18px">🏕</span>
    <span>
      <strong style="color:#22c55e">CampSniper</strong> found
      <strong>${target.siteName}</strong>${target.sectionName ? ` (${target.sectionName})` : ''} available —
      ${target.mode === 'autopay' ? 'auto-clicking Reserve…' : 'click <strong>Reserve</strong> to add it to your cart.'}
    </span>
    <span id="campsniper-status" style="margin-left:auto;color:#94a3b8;font-size:11px;white-space:nowrap">Loading…</span>
  `)

  const setStatus = (msg: string) => {
    const el = document.getElementById('campsniper-status')
    if (el) el.textContent = msg
  }

  // Step 1: wait for Angular to render (2s)
  await sleep(2000)

  // Step 2: if BC Parks shows the search form instead of results (happens when
  // mapId === resourceLocationId), select the park then click Search
  const hasResults = document.querySelector(
    'mat-card, .site-card, [class*="campsite-card"], [class*="resource-card"], [class*="site-list"]'
  )
  if (!hasResults) {
    if (target.parkName) {
      setStatus(`Selecting park "${target.parkName}"…`)
      const selected = await selectParkFromDropdown(target.parkName)
      if (selected) await sleep(500)
    }
    setStatus('Clicking Search…')
    const clicked = await clickSearchButton()
    if (clicked) {
      setStatus('Waiting for results…')
      await sleep(5000)  // give Angular time to render results
    } else {
      setStatus('Search button not found — click Search manually, then Reserve.')
    }
  }

  // Step 3: try to auto-click Reserve for the target site
  const found = await tryClickReserve(target, 12_000)

  if (found) {
    setStatus(target.mode === 'autopay'
      ? 'Reserved — proceeding to payment…'
      : 'Reserved ✓ — complete payment in BC Parks')
  } else {
    setStatus(`Scroll down to find Site ${target.siteName} and click Reserve.`)
    tryHighlightSite(target.siteName)
  }
}

// Select a park from the Angular Material mat-select dropdown
async function selectParkFromDropdown(parkName: string): Promise<boolean> {
  // Find the Park mat-select (first one on the page)
  const trigger = document.querySelector('mat-select, [role="combobox"]') as HTMLElement | null
  if (!trigger) return false

  trigger.click()
  await sleep(800)  // wait for Angular overlay to open

  // mat-option elements render in an overlay appended to document.body
  const options = document.querySelectorAll('mat-option, [role="option"]')
  if (options.length === 0) {
    // Close and give up
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return false
  }

  const needle = parkName.toLowerCase()
  for (const opt of options) {
    const text = (opt.textContent ?? '').trim().toLowerCase()
    // Match if either contains the other (handles "Golden Ears" ↔ "Golden Ears Provincial Park")
    if (text.includes(needle) || needle.includes(text.replace(/\s*(provincial|park|campground)\s*/gi, '').trim())) {
      ;(opt as HTMLElement).click()
      return true
    }
  }

  // No match — close dropdown and let Search run with "All Parks"
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return false
}

// Click the Search button on the BC Parks search form
async function clickSearchButton(): Promise<boolean> {
  // Try multiple selectors for the Search button
  const selectors = [
    'button.search-btn',
    'button[class*="search"]',
    'button[color="primary"][mat-raised-button]',
    'button[mat-raised-button][color="primary"]',
  ]
  for (const sel of selectors) {
    const btn = document.querySelector(sel) as HTMLElement | null
    if (btn && !btn.disabled) { btn.click(); return true }
  }
  // Fallback: find by button text
  const allBtns = document.querySelectorAll('button')
  for (const btn of allBtns) {
    const text = (btn.textContent ?? '').trim().toLowerCase()
    if (text === 'search' || text.includes('search')) {
      ;(btn as HTMLElement).click()
      return true
    }
  }
  return false
}

async function tryClickReserve(target: TargetSite, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // Search by site name text content
    const candidates = document.querySelectorAll(
      'mat-card, [class*="site-card"], [class*="campsite"], [class*="resource-item"], [class*="result-item"]'
    )
    for (const el of candidates) {
      if ((el.textContent ?? '').includes(target.siteName)) {
        const btn = findReserveButton(el)
        if (btn) { ;(btn as HTMLElement).click(); return true }
      }
    }
    // Also search by data attributes (Angular ng-reflect)
    const byData = document.querySelector(
      `[data-resource-id="${target.resourceId}"], [ng-reflect-resource-id="${target.resourceId}"]`
    )
    if (byData) {
      const btn = findReserveButton(byData)
      if (btn) { ;(btn as HTMLElement).click(); return true }
    }
    await sleep(500)
  }
  return false
}

function findReserveButton(container: Element): Element | null {
  // Walk up through parent elements looking for a Reserve/Add-to-cart button
  let el: Element | null = container
  for (let i = 0; i < 6 && el; i++) {
    const btn = el.querySelector(
      'button[class*="reserve"], button[class*="Reserve"], ' +
      'button[class*="book"], button[class*="add-to-cart"], ' +
      'button[mat-raised-button][color="primary"], button[mat-flat-button][color="primary"], ' +
      'button:not([disabled])[color="primary"]'
    )
    if (btn) return btn
    el = el.parentElement
  }
  return null
}

function tryHighlightSite(siteName: string): void {
  document.querySelectorAll('mat-card, [class*="site-card"], [class*="campsite"]').forEach(el => {
    if ((el.textContent ?? '').includes(siteName)) {
      ;(el as HTMLElement).style.outline = '3px solid #22c55e'
      ;(el as HTMLElement).style.boxShadow = '0 0 20px rgba(34,197,94,0.4)'
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

// ── Checkout pages: auto-pay ───────────────────────────────────────────────

async function waitForElement(selector: string, timeoutMs = 10_000): Promise<Element> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector)
    if (el) { resolve(el); return }
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (found) { observer.disconnect(); resolve(found) }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)) }, timeoutMs)
  })
}

async function clickWhenReady(selector: string): Promise<void> {
  const el = await waitForElement(selector)
  ;(el as HTMLElement).click()
}

async function fillInput(selector: string, value: string): Promise<void> {
  const el = await waitForElement(selector) as HTMLInputElement
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function runCheckout(tripId: string): Promise<void> {
  const url = window.location.href
  try {
    if (url.includes('reservationmessages')) {
      // Step 5 — surcharges / reservation messages
      // TODO: verify selector by pasting HTML of this step here
      await clickWhenReady(
        'button[data-test="continue-button"], .continue-btn, button.mat-raised-button[color="primary"], button[type="submit"]'
      )
      return
    }
    if (url.includes('occupant') || url.includes('campsite-details')) {
      // Step 6 — occupant details
      // TODO: verify selector by pasting HTML of this step here
      await clickWhenReady(
        'button[data-test="continue-button"], .continue-btn, button.mat-raised-button[color="primary"], button[type="submit"]'
      )
      return
    }
    if (url.includes('payment') || url.includes('checkout')) {
      // Step 7 — payment (selectors confirmed from live HTML)
      const { payment } = await new Promise<Record<string, unknown>>(resolve =>
        chrome.storage.local.get('payment', resolve)
      ) as { payment: { cardNumber: string; cardHolder: string; cardExpiry: string; cardCvv: string } | null }
      if (!payment) throw new Error('No payment info — add it in CampSniper Settings.')
      await fillInput('#cardNumber', payment.cardNumber)
      await fillInput('#cardHolderName', payment.cardHolder)
      await fillInput('#cardExpiry', payment.cardExpiry)
      await fillInput('#cardCvv', payment.cardCvv)
      await clickWhenReady('#applyPaymentButton')
      const confirmEl = await waitForElement(
        '[class*="confirmation"], [class*="booking-ref"], [class*="reference-number"], h1', 20_000
      )
      const confirmationNumber = confirmEl.textContent?.trim() ?? 'unknown'
      chrome.runtime.sendMessage({ type: 'BOOKING_CONFIRMED', tripId, confirmationNumber })
      chrome.storage.local.remove('campSnaperTarget')
    }
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'BOOKING_FAILED', tripId, error: String(err) })
  }
}
