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
  noDouble: boolean
  noWalkin: boolean
  checkIn: string   // ISO date — needed to build the attempted key on failure
  checkOut: string
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
  } else if (url.includes('reservationmessages')) {
    // "Review Reservation Details" page then surcharges — both at this URL
    // Must check box + confirm to lock site in cart (15-min hold timer starts here)
    dbg('detected: reservationmessages page')
    handleReservationReview(target.tripId, target.mode)
  } else if (url.includes('payment') || url.includes('checkout') || url.includes('occupant') || url.includes('campsite-details')) {
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

  // Step 3: apply BC Parks native filters (Walk-in: No, Double Site: No)
  if (target.noWalkin || target.noDouble) {
    setStatus('Applying filters…')
    await applyBCParksFilters(target.noWalkin, target.noDouble)
    dbg('filters applied', { noWalkin: target.noWalkin, noDouble: target.noDouble })
    // Wait for filtered results to reload
    await pollForToggles(8_000)
  }

  // Step 4: switch to List view, then immediately poll for category buttons
  // Category buttons (button.map-link-button) appear as soon as List loads —
  // much faster than waiting for panels which only appear after clicking a category.
  setStatus('Switching to list view…')
  const switched = await switchToListView()
  dbg('switchToListView', switched)

  // Poll for either category buttons OR panels (whichever appears first)
  const listReady = await pollUntil(6_000, () =>
    document.querySelectorAll('button.map-link-button, mat-expansion-panel.list-entry').length > 0
  )
  dbg('list ready', listReady)

  panelCount = document.querySelectorAll('mat-expansion-panel.list-entry').length
  const catBtnCount = document.querySelectorAll('button.map-link-button').length
  dbg('list state', { panelCount, catBtnCount })

  // If we're at category level (Campground / Walk-in rows), click Campground immediately
  if (panelCount === 0 && catBtnCount > 0) {
    setStatus('Selecting Campground category…')
    const catClicked = await clickCampgroundCategory()
    dbg('campground category clicked', catClicked)
    panelCount = await pollForPanels(6_000)
    dbg('panels after category click', panelCount)
  }

  if (panelCount === 0) {
    setStatus('List view not loading — click "List" → "Campground" → "Details" → "Reserve" manually.')
    dbg('FAILED: panels never appeared. Paste __cs_debug() to developer.')
    return
  }

  // Step 4: expand panels and click Reserve
  setStatus(`${panelCount} sites found — clicking Reserve…`)
  const reserved = await expandAndReserve(target.siteName, target.noDouble, target.noWalkin)
  dbg('expandAndReserve', reserved)

  if (reserved) {
    setStatus(target.mode === 'autopay'
      ? 'Reserved — proceeding to payment…'
      : 'Reserved ✓ — complete payment in BC Parks')
  } else {
    // Site was taken between scan detection and page load — tell background to
    // mark this specific site as attempted and resume scanning automatically.
    setStatus('Site no longer available — resuming scan…')
    dbg('MATCH_FAILED — site taken, notifying background')
    chrome.runtime.sendMessage({
      type: 'MATCH_FAILED',
      tripId: target.tripId,
      attemptKey: `${target.resourceId}|${target.checkIn}|${target.checkOut}`,
    })
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

// Apply BC Parks native UI filters via the Filters dialog.
//
// Confirmed DOM structure (from Playwright inspection across Porteau Cove, Rolley Lake,
// Alice Lake, Golden Ears):
//   <app-single-selection-filter>
//     <h3> Walk In </h3>          ← heading identifies the group
//     <mat-radio-group>
//       <mat-radio-button>No Preference</mat-radio-button>
//       <mat-radio-button>Yes</mat-radio-button>
//       <mat-radio-button>No</mat-radio-button>   ← we want this one
//     </mat-radio-group>
//   </app-single-selection-filter>
//   <app-single-selection-filter>
//     <h3> Double Site </h3>
//     ...same structure...
//   </app-single-selection-filter>
//   (Electrical Service uses <p class="filter-option"> + mat-checkbox — different component)
//
// Selecting by h3 text → clicking "No" mat-radio-button within that component
// is robust regardless of how many filter groups the park has.
async function applyBCParksFilters(noWalkin: boolean, noDouble: boolean): Promise<void> {
  // Dismiss cookie banner if present
  const cookieBtn = Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').trim().toLowerCase() === 'i consent')
  if (cookieBtn) { ;(cookieBtn as HTMLElement).click(); await sleep(400) }

  const filterBtn = document.getElementById('filters-button-desktop') as HTMLElement | null
  if (!filterBtn) { dbg('filters button not found'); return }
  filterBtn.click()
  await sleep(1000)

  // Find the app-single-selection-filter whose <h3> contains the keyword,
  // then click the mat-radio-button with text "No" inside it.
  // Must click the inner <label> — mat-radio-button.click() doesn't trigger Angular.
  const clickNoForGroup = (headingKeyword: string): boolean => {
    const groups = document.querySelectorAll('app-single-selection-filter')
    dbg(`filter groups found`, groups.length)
    for (const group of Array.from(groups)) {
      const h3 = group.querySelector('h3')
      const heading = (h3?.textContent ?? '').trim().toLowerCase()
      if (!heading.includes(headingKeyword.toLowerCase())) continue
      const radios = Array.from(group.querySelectorAll('mat-radio-button'))
      const noRadio = radios.find(r => (r.textContent ?? '').trim().toLowerCase() === 'no')
      dbg(`group "${heading}"`, { radios: radios.length, noFound: !!noRadio })
      if (noRadio) {
        const label = noRadio.querySelector('label') as HTMLElement | null
        ;(label ?? noRadio as HTMLElement).click()
        dbg(`clicked "No" for "${heading}"`)
        return true
      }
    }
    dbg(`filter group containing "${headingKeyword}" not found`)
    return false
  }

  if (noWalkin) clickNoForGroup('walk')
  if (noDouble) clickNoForGroup('double')
  await sleep(300)

  const showBtn = Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').trim().toLowerCase().includes('show results'))
  if (showBtn) { ;(showBtn as HTMLElement).click(); dbg('Show results clicked') }
  await sleep(2000)
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
async function expandAndReserve(targetSiteName: string, noDouble: boolean, noWalkin: boolean): Promise<boolean> {
  // Load all panels first (click "View more" if present)
  await loadAllPanels()

  let panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
  if (panels.length === 0) {
    await sleep(2000)
    panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
    if (panels.length === 0) return false
  }
  dbg('total panels', panels.length)

  // Pre-check collapsed text: if target site not visible, skip pass 0 entirely
  // (saves expanding each panel just to collapse — each expand takes ~800ms)
  const siteRegex = new RegExp(`Campsite\\s*\\n?\\s*${targetSiteName}(?:\\s|$)`, 'i')
  const targetVisible = panels.some(p => siteRegex.test(p.textContent ?? ''))
  dbg('target site visible in collapsed panels', { target: targetSiteName, visible: targetVisible })

  let panelsChecked = 0
  const startTime = Date.now()

  // Pass 0 only if target site appears in collapsed text; Pass 1 = any eligible site
  for (const pass of (targetVisible ? [0, 1] : [1])) {
    dbg(`expandAndReserve pass ${pass}`, { totalPanels: panels.length })
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]
      const header = panel.querySelector('mat-expansion-panel-header[role="button"]') as HTMLElement | null
      if (!header) continue

      const alreadyOpen = panel.classList.contains('mat-expanded')
      if (!alreadyOpen) {
        header.click()
        // Poll for panel content instead of fixed sleep (Angular animation ~300ms)
        await pollUntil(800, () => panel.classList.contains('mat-expanded'))
        panelsChecked++
      }

      // Read collapsed/summary text for pass-0 name matching — "Campsite 50 AvailableDetails"
      const summaryText = panel.textContent ?? ''

      if (pass === 0) {
        const siteRegex = new RegExp(`Campsite\\s*\\n?\\s*${targetSiteName}(?:\\s|$)`, 'i')
        const matches = siteRegex.test(summaryText)
        dbg(`panel ${i} name match`, { target: targetSiteName, matches, text: summaryText.trim().substring(0, 50) })
        if (!matches) {
          if (!alreadyOpen) header.click()
          continue
        }
      }

      // BC Parks list view shows a "Details" button inside the expanded panel before the Reserve
      // button is visible. Click it to load full site info (may open a sidebar outside the panel).
      if (!panel.querySelector('button.reserve-button')) {
        const detailsBtn = Array.from(panel.querySelectorAll('button'))
          .find(b => (b.textContent ?? '').trim().toLowerCase() === 'details')
        dbg(`panel ${i} Details btn`, { found: !!detailsBtn })
        if (detailsBtn) {
          ;(detailsBtn as HTMLElement).click()
          await pollUntil(3000, () => !!document.querySelector('button.reserve-button'))
        }
      }

      // Reserve button may now be inside the panel OR in a sidebar opened by Details click
      const reserveBtn = document.querySelector('button.reserve-button') as HTMLButtonElement | null
      dbg(`panel ${i} reserveBtn`, { found: !!reserveBtn, disabled: reserveBtn?.disabled })

      // Read UI flags from whichever element contains the reserve button.
      // Falls back to panel if the button is in a sidebar with no mat-expansion-panel ancestor.
      const contextEl = reserveBtn?.closest('mat-expansion-panel') ?? reserveBtn?.parentElement ?? panel
      const panelText = contextEl.textContent ?? ''

      // Enforce filters — site details show "Double Site: Yes" / "Walk In: Yes"
      const doubleMatch = panelText.match(/double\s*site\s*:?\s*(\w+)/i)
      const walkinMatch = panelText.match(/walk\s*[-\s]?in\s*:?\s*(\w+)/i)
      const isDoubleInUI = doubleMatch ? doubleMatch[1].toLowerCase() === 'yes' : false
      const isWalkinInUI = walkinMatch ? walkinMatch[1].toLowerCase() === 'yes' : false
      dbg(`panel ${i} UI flags`, {
        isDoubleInUI, isWalkinInUI, noDouble, noWalkin,
        doubleText: doubleMatch?.[0] ?? 'not found',
        walkinText: walkinMatch?.[0] ?? 'not found',
        panelSnippet: panelText.replace(/\s+/g, ' ').substring(0, 120),
      })
      if (noDouble && isDoubleInUI) {
        dbg(`panel ${i} skipped — double site (UI)`)
        if (!alreadyOpen) { header.click(); await sleep(200) }
        continue
      }
      if (noWalkin && isWalkinInUI) {
        dbg(`panel ${i} skipped — walk-in site (UI)`)
        if (!alreadyOpen) { header.click(); await sleep(200) }
        continue
      }

      if (reserveBtn && !reserveBtn.disabled) {
        const selectedSite = summaryText.match(/Campsite\s*(\d+)/i)?.[1] ?? '?'
        dbg(`SELECTED Campsite ${selectedSite}`, {
          pass,
          panelsExpanded: panelsChecked,
          elapsedMs: Date.now() - startTime,
          isDouble: isDoubleInUI,
          isWalkin: isWalkinInUI,
        })
        const urlBefore = window.location.href
        reserveBtn.click()
        dbg(`clicked reserve on panel ${i}`)

        // Poll for outcome (up to 4s):
        //   - URL changed → navigation succeeded, site is ours
        //   - "not available" error in panel → site was grabbed by someone else just now
        //   - double-site dialog → cancel and skip
        let navigated = false
        const pollEnd = Date.now() + 4000
        while (Date.now() < pollEnd) {
          if (await cancelIfDoubleDialog()) {
            dbg(`panel ${i} double-site dialog — skipping`)
            break
          }
          if (window.location.href !== urlBefore) {
            navigated = true
            break
          }
          const liveText = (contextEl.textContent ?? '').toLowerCase()
          if (
            liveText.includes('not available for any of the requested') ||
            liveText.includes('not reservable')
          ) {
            dbg(`panel ${i} site not available/reservable — skipping`)
            break
          }
          await sleep(200)
        }

        if (navigated) return true
        if (!alreadyOpen) { header.click(); await sleep(300) }
        continue
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
    const prevCount = document.querySelectorAll('mat-expansion-panel.list-entry').length
    dbg('clicking View more')
    ;(viewMore as HTMLElement).click()
    // Wait until panel count increases (new panels loaded) or 2s max
    await pollUntil(2000, () =>
      document.querySelectorAll('mat-expansion-panel.list-entry').length > prevCount
    )
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



// ── Reservation review page (after clicking Reserve, before payment) ────────

// "Review Reservation Details" page.
// Checking the box and clicking Confirm is REQUIRED to lock the site into the cart.
// For hold mode: stops after confirm (15-min hold active, user pays manually).
// For autopay: continues through surcharges → payment.
// Handles reservationmessages page which has two states:
// State 1: "Review Reservation Details" — checkbox + "Confirm reservation details" button
// State 2: Surcharges — Continue button (page stays at same URL after confirming)
async function handleReservationReview(tripId: string, mode: 'hold' | 'autopay'): Promise<void> {
  injectBanner(`<span style="font-size:18px">🏕</span>
    <span><strong style="color:#22c55e">CampSniper</strong> — locking site in cart…</span>
    <span id="campsniper-status" style="margin-left:auto;color:#94a3b8;font-size:11px">Working…</span>`)
  const setStatus = (msg: string) => {
    const el = document.getElementById('campsniper-status')
    if (el) el.textContent = msg
  }
  try {
    await sleep(1500)

    // State 1: Check "All reservation details are correct" checkbox if present
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    dbg('checkbox found', !!checkbox)
    if (checkbox && !checkbox.checked) {
      checkbox.click()
      dbg('checked acknowledge checkbox')
      await sleep(600)
    }

    // State 1: Click "Confirm reservation details" if present
    const confirmBtn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').toLowerCase().includes('confirm reservation'))
    dbg('confirm button found', !!confirmBtn)

    if (confirmBtn) {
      ;(confirmBtn as HTMLElement).click()
      dbg('clicked Confirm reservation details')
      await sleep(2000)  // wait for page to transition to surcharges state
    }

    if (mode === 'hold') {
      // For hold: site is now locked in cart with 15-min timer — user pays manually
      setStatus('Site held for 15 min — complete payment now!')
      dbg('hold complete — site in cart')
      return
    }

    // Autopay: State 2 — surcharges Continue button (same URL after confirm)
    setStatus('Confirming surcharges…')
    const continueBtn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.textContent ?? '').trim().toLowerCase()
      return t === 'continue' || t.includes('continue') || t.includes('proceed')
    })
    dbg('continue button found', !!continueBtn)
    if (continueBtn) {
      ;(continueBtn as HTMLElement).click()
      setStatus('Proceeding to occupant details…')
    } else {
      setStatus('Click Continue to proceed to payment.')
    }
  } catch (e) {
    dbg('handleReservationReview error', String(e))
    setStatus('Error — confirm the reservation manually.')
  }
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
