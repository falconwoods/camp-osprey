// Content script — injected on all camping.bcparks.ca pages

// ── Debug logging ──────────────────────────────────────────────────────────
// Content scripts run in an isolated world — window vars aren't visible in DevTools console.
// We write logs to a hidden DOM element instead, readable from the page context.
const _dbg: string[] = []
function dbg(msg: string, data?: unknown): void {
  const line = data !== undefined ? `${msg} ${JSON.stringify(data)}` : msg
  _dbg.push(`[${new Date().toLocaleTimeString()}] ${line}`)
  console.log(`[CampSniper] ${line}`)
  // Write to hidden DOM element so DevTools console can access it:
  // copy(document.getElementById('__cs_log').textContent)
  let el = document.getElementById('__cs_log')
  if (!el) {
    el = document.createElement('pre')
    el.id = '__cs_log'
    el.style.cssText = 'display:none'
    document.body.appendChild(el)
  }
  el.textContent = _dbg.join('\n')
}

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
dbg('content script loaded', { url: window.location.pathname })

chrome.storage.local.get('campSnaperTarget', (result: Record<string, unknown>) => {
  if (chrome.runtime.lastError) {
    dbg('storage error', chrome.runtime.lastError.message); return
  }
  const target = result?.['campSnaperTarget'] as TargetSite | undefined
  if (!target) { dbg('no campSnaperTarget in storage'); return }
  const age = Math.round((Date.now() - target.setAt) / 1000)
  dbg('target loaded', { ...target, ageSeconds: age })
  if (age > 300) { dbg('target is stale, ignoring'); return }

  const url = window.location.href
  if (url.includes('/create-booking/results')) {
    dbg('detected: results page')
    handleResultsPage(target)
  } else if (url.includes('reservationmessages') || url.includes('payment') || url.includes('checkout')) {
    dbg('detected: checkout page')
    if (target.mode === 'autopay') runCheckout(target.tripId)
  } else {
    dbg('page not matched for auto-action', { url })
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

  // Step 2: detect if the URL has the "bad" mapId (equals resourceLocationId)
  // This happens when buildBookingUrl falls back to park ID for mapId.
  // Fix: fetch the correct transactionLocationId + rootMapId from BC Parks API
  // and navigate directly — no search form interaction needed.
  const params = new URLSearchParams(window.location.search)
  const resourceLocationId = params.get('resourceLocationId') || ''
  const mapId = params.get('mapId') || ''
  const checkIn = params.get('startDate') || ''
  const checkOut = params.get('endDate') || ''
  const nights = params.get('nights') || '1'

  dbg('URL params', { resourceLocationId, mapId, badUrl: mapId === resourceLocationId })

  if (mapId === resourceLocationId && resourceLocationId) {
    setStatus('Fixing URL — fetching correct park parameters…')
    const correctUrl = await buildCorrectResultsUrl(resourceLocationId, checkIn, checkOut, nights)
    dbg('correct URL', correctUrl?.substring(0, 100) ?? 'failed')
    if (correctUrl) {
      setStatus('Navigating to correct results page…')
      window.location.replace(correctUrl)
      return  // content script re-runs on the new page
    }
    dbg('could not build correct URL — falling back to search form')
  }

  // Step 3: wait for results view toggles to appear
  let panelCount = document.querySelectorAll('mat-expansion-panel.list-entry').length
  const toggleCount = document.querySelectorAll('mat-button-toggle').length
  dbg('after 2s wait', { panels: panelCount, toggles: toggleCount })

  if (panelCount === 0 && toggleCount === 0) {
    setStatus('Waiting for results to load…')
    const loaded = await pollForToggles(20_000)
    dbg('results loaded', loaded)
    if (!loaded) {
      setStatus('Results not loading — try refreshing the page.')
      dbg('FAILED: no toggles appeared. Paste __cs_debug() to developer.')
      return
    }
  }

  // Step 3: switch to List view
  setStatus('Switching to list view…')
  const switched = await switchToListView()
  dbg('switchToListView', switched)
  await sleep(500)
  panelCount = await pollForPanels(6_000)
  dbg('panels after list switch', panelCount)

  // Step 4: if no site panels yet, we're at the category level
  // (BC Parks shows Campground / Walk-in category rows before individual sites)
  // Click the non-walk-in category to drill into individual sites
  if (panelCount === 0) {
    setStatus('Selecting Campground category…')
    const catClicked = await clickCampgroundCategory()
    dbg('campground category clicked', catClicked)
    await sleep(1000)
    panelCount = await pollForPanels(8_000)
    dbg('panels after category click', panelCount)
  }

  if (panelCount === 0) {
    setStatus('List view not loading — click "List" → "Campground" → "Details" → "Reserve" manually.')
    dbg('FAILED: panels never appeared. Paste __cs_debug() to developer.')
    return
  }

  // Step 4: expand panels and click Reserve
  setStatus(`${panelCount} sites found — clicking Reserve on first available…`)
  const reserved = await expandAndReserve(target.siteName)
  dbg('expandAndReserve', reserved)

  if (reserved) {
    setStatus(target.mode === 'autopay'
      ? 'Reserved — proceeding to payment…'
      : 'Reserved ✓ — complete payment in BC Parks')
  } else {
    setStatus('Click "Details" on a site then click "Reserve" manually.')
    dbg('FAILED — paste __cs_debug() output to developer')
  }
}

// Generic poll: call fn every 200ms, return true when fn returns true
async function pollUntil(timeoutMs: number, fn: () => boolean): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await sleep(200)
  }
  return false
}

// Poll for Map/List/Calendar toggles — these appear in any results view
async function pollForToggles(timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const t = document.querySelectorAll('mat-button-toggle')
    if (t.length > 0) {
      dbg(`pollForToggles: ${t.length} toggles after ${Date.now() - start}ms`)
      return true
    }
    await sleep(500)
  }
  dbg(`pollForToggles: timed out after ${timeoutMs}ms`)
  return false
}

// Poll for mat-expansion-panel.list-entry — only present in List view
async function pollForPanels(timeoutMs: number): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const panels = document.querySelectorAll('mat-expansion-panel.list-entry')
    if (panels.length > 0) {
      dbg(`pollForPanels: ${panels.length} panels after ${Date.now() - start}ms`)
      return panels.length
    }
    await sleep(500)
  }
  dbg(`pollForPanels: timed out after ${timeoutMs}ms`)
  return 0
}

// Fetch transactionLocationId and rootMapId from BC Parks API, return correct results URL
async function buildCorrectResultsUrl(resourceLocationId: string, checkIn: string, checkOut: string, nights: string): Promise<string | null> {
  try {
    const resp = await fetch('/api/resourceLocation', { credentials: 'include' })
    if (!resp.ok) { dbg('resourceLocation fetch failed', resp.status); return null }
    const locs = await resp.json() as Array<Record<string, unknown>>
    const loc = locs.find(l => String(l['resourceLocationId']) === resourceLocationId)
    if (!loc) { dbg('location not found', resourceLocationId); return null }
    const tli = String(loc['transactionLocationId'])
    const rootMapId = String(loc['rootMapId'])
    dbg('correct params', { tli, rootMapId })
    return `https://camping.bcparks.ca/create-booking/results` +
      `?transactionLocationId=${tli}&resourceLocationId=${resourceLocationId}&mapId=${rootMapId}` +
      `&searchTabGroupId=0&bookingCategoryId=0&startDate=${checkIn}&endDate=${checkOut}` +
      `&nights=${nights}&isReserving=true&equipmentId=-32768&subEquipmentId=-32768`
  } catch (e) {
    dbg('buildCorrectResultsUrl error', String(e))
    return null
  }
}

// Click the Campground category row to drill into individual site panels.
// BC Parks shows category rows (Campground, Walk-in) before individual sites in List view.
// Each row has a button.map-link-button — click the Campground one (not Walk-in).
async function clickCampgroundCategory(): Promise<boolean> {
  const btns = document.querySelectorAll('button.map-link-button')
  dbg('map-link-buttons found', btns.length)
  for (const btn of btns) {
    const text = (btn.textContent ?? '').trim().toLowerCase()
    dbg('map-link-button text', text.substring(0, 40))
    if (text.includes('campground') && !text.includes('walk')) {
      ;(btn as HTMLElement).click()
      return true
    }
  }
  // Fallback: any non-walk-in category row
  for (const btn of btns) {
    const text = (btn.textContent ?? '').trim().toLowerCase()
    if (!text.includes('walk')) {
      ;(btn as HTMLElement).click()
      return true
    }
  }
  return false
}

// Switch to List view — confirmed selector from Playwright inspection
async function switchToListView(): Promise<boolean> {
  const allToggles = document.querySelectorAll('mat-button-toggle')
  dbg('mat-button-toggles found', allToggles.length)
  for (const t of allToggles) {
    const text = (t.textContent ?? '').trim()
    dbg('toggle', { text, cls: t.className.substring(0, 40) })
    if (text === 'List') {
      const btn = t.querySelector('button') as HTMLElement | null
      if (btn) { btn.click(); return true }
    }
  }
  return false
}

// Expand BC Parks mat-expansion-panel.list-entry rows and click Reserve.
async function expandAndReserve(targetSiteName: string): Promise<boolean> {
  // Load all panels first (click "View more" if present)
  await loadAllPanels()

  let panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
  if (panels.length === 0) {
    await sleep(2000)
    panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
    if (panels.length === 0) return false
  }
  dbg('total panels', panels.length)

  // Pass 0: find panel matching target site name (avoids double sites from the API's filtered list)
  // Pass 1: any panel, but skip double sites via dialog detection
  for (const pass of [0, 1]) {
    dbg(`expandAndReserve pass ${pass}`)
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]
      const header = panel.querySelector('mat-expansion-panel-header[role="button"]') as HTMLElement | null
      if (!header) continue

      const alreadyOpen = panel.classList.contains('mat-expanded')
      if (!alreadyOpen) { header.click(); await sleep(600) }

      if (pass === 0) {
        const siteRegex = new RegExp(`(Campsite|Site|#|^|\\s)\\s*${targetSiteName}(\\s|$)`, 'i')
        const matches = siteRegex.test(panel.textContent ?? '')
        dbg(`panel ${i} name match`, { target: targetSiteName, matches, text: (panel.textContent??'').trim().substring(0,50) })
        if (!matches) {
          if (!alreadyOpen) { header.click(); await sleep(200) }
          continue
        }
      }

      const reserveBtn = panel.querySelector('button.reserve-button') as HTMLButtonElement | null
      dbg(`panel ${i} reserveBtn`, { found: !!reserveBtn, disabled: reserveBtn?.disabled })

      if (reserveBtn && !reserveBtn.disabled) {
        reserveBtn.click()
        dbg(`clicked reserve on panel ${i}`)
        await sleep(1000)  // wait for possible double-site dialog

        // If BC Parks shows "double site" dialog, cancel and skip to next panel
        if (await cancelIfDoubleDialog()) {
          dbg(`panel ${i} is a double site — skipping`)
          if (!alreadyOpen) { header.click(); await sleep(300) }
          continue
        }
        return true
      }

      if (!alreadyOpen) { header.click(); await sleep(200) }
    }
  }
  dbg('no usable reserve button found in any panel')
  return false
}

// Click "View more" until all panels are loaded
async function loadAllPanels(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const viewMore = Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').trim().toLowerCase().includes('view more'))
    if (!viewMore) break
    dbg('clicking View more')
    ;(viewMore as HTMLElement).click()
    await sleep(1500)
  }
}

// Detect "This is part of a Double Site" dialog and click Cancel
async function cancelIfDoubleDialog(): Promise<boolean> {
  const dialog = document.querySelector('mat-dialog-container, [role="dialog"]')
  if (!dialog) return false
  const text = (dialog.textContent ?? '').toLowerCase()
  if (!text.includes('double')) return false
  dbg('double site dialog — cancelling')
  const cancelBtn = Array.from(dialog.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').trim().toLowerCase() === 'cancel')
  if (cancelBtn) { ;(cancelBtn as HTMLElement).click(); await sleep(500) }
  return true
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
