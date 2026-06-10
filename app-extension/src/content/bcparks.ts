// Content script — injected on all camping.bcparks.ca pages
import { extractCampsiteName, extractSelectedCampsiteName, findBookingConfirmation, findDetailsControl, findPaymentFailure, findReserveControl, hasListResultOutcome, hasNoAvailabilityMessage, isExpansionPanelOpen, reservePasses } from './reserveStrategy'
import { LogEventCode, RuntimeMessageCode } from '../protocol'

// ── Debug logging ──────────────────────────────────────────────────────────
// Content scripts run in an isolated world — window vars aren't visible in DevTools console.
// We write logs to a hidden DOM element instead, readable from the page context.
const _dbg: string[] = []
let activeTargetSite: TargetSite | null = null

function dbg(msg: string, data?: unknown): void {
  const line = data !== undefined ? `${msg} ${JSON.stringify(data)}` : msg
  _dbg.push(`[${new Date().toLocaleTimeString()}] ${line}`)
  console.log(`[campsoon] ${line}`)
  chrome.runtime.sendMessage({
    t: RuntimeMessageCode.contentDebugLog,
    level: msg.includes('FAILED') || msg.includes('error') ? 'warning' : 'info',
    eventCode: LogEventCode.contentScriptLog,
    message: msg,
    tripId: activeTargetSite?.tripId,
    parkName: activeTargetSite?.parkName,
    siteName: activeTargetSite?.siteName,
    checkIn: activeTargetSite?.checkIn,
    checkOut: activeTargetSite?.checkOut,
    metadata: {
      data: data ?? null,
      path: window.location.pathname,
      url: window.location.href,
    },
  }, () => {
    // Ignore missing receiver / closed extension context; DevTools DOM log remains available.
    void chrome.runtime.lastError
  })
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
  mode: 'reserve' | 'autopay'
  noDouble: boolean
  noWalkin: boolean
  checkIn: string   // ISO date — needed to build the attempted key on failure
  checkOut: string
  availableCount?: number
  scanLease?: string
  setAt: number
}

// content scripts can only access chrome.storage.local, not session
dbg('content script loaded', { url: window.location.pathname })

// BC Parks is an Angular SPA — route changes happen via pushState with no page reload.
// The content script only runs once on initial load, so we poll for URL changes and
// re-dispatch when Angular navigates to a new route.
//
// The results page is handled ONCE on initial load only — re-triggering it on the
// same path (e.g. after filter dialog changes query params) causes duplicate handlers.
// The watcher only dispatches for reservationmessages and checkout steps.
chrome.storage.local.get('campOspreyTarget', (result: Record<string, unknown>) => {
  if (chrome.runtime.lastError) {
    dbg('storage error', chrome.runtime.lastError.message); return
  }
  const target = result?.['campOspreyTarget'] as TargetSite | undefined
  if (!target) { dbg('no campOspreyTarget in storage'); return }
  activeTargetSite = target
  const age = Math.round((Date.now() - target.setAt) / 1000)
  dbg('target loaded', { ...target, ageSeconds: age })
  if (age > 300) { dbg('target is stale, ignoring'); return }

  // Handle initial URL (results page only — other pages handled by watcher below)
  const initialUrl = window.location.href
  if (initialUrl.includes('/create-booking/results')) {
    dbg('detected: results page (initial)')
    handleResultsPage(target)
  } else if (initialUrl.includes('reservationmessages')) {
    dbg('detected: reservationmessages page (initial)')
    handleReservationReview(target.tripId, target.mode)
  } else if (initialUrl.includes('/create-booking/') && target.mode === 'autopay') {
    dbg('detected: checkout step (initial)')
    runCheckout(target.tripId)
  }

  // Watch for SPA navigation to new routes (not re-triggers of /results)
  let lastPath = new URL(window.location.href).pathname
  const watcher = setInterval(() => {
    const path = new URL(window.location.href).pathname
    if (path === lastPath) return
    lastPath = path
    const url = window.location.href
    dbg('SPA navigation detected', { url: path })

    if (url.includes('reservationmessages')) {
      dbg('detected: reservationmessages page')
      handleReservationReview(target.tripId, target.mode)
    } else if (url.includes('/create-booking/') && !url.includes('/results') && target.mode === 'autopay') {
      dbg('detected: checkout step')
      runCheckout(target.tripId)
    } else {
      dbg('SPA: no action for this route', { path })
    }
  }, 300)

  // Stop watching after 15 minutes (cart expires anyway)
  setTimeout(() => clearInterval(watcher), 15 * 60 * 1000)
})

// ── Banner (fixed bottom so it never covers BC Parks nav/cart) ─────────────

function injectBanner(html: string): HTMLElement {
  const existing = document.getElementById('campsoon-banner')
  if (existing) existing.remove()
  const banner = document.createElement('div')
  banner.id = 'campsoon-banner'
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
  const availableCount = target.availableCount ?? 1
  const foundLabel = `${availableCount} available site${availableCount === 1 ? '' : 's'}`
  injectBanner(`
    <span style="font-size:18px">🏕</span>
    <span>
      <strong style="color:#22c55e">campsoon</strong> found
      <strong>${foundLabel}</strong> —
      ${target.mode === 'autopay' ? 'auto-clicking Reserve…' : 'click <strong>Reserve</strong> to add it to your cart.'}
    </span>
    <span id="campsoon-status" style="margin-left:auto;color:#94a3b8;font-size:11px;white-space:nowrap">Loading…</span>
  `)

  const setStatus = (msg: string) => {
    const el = document.getElementById('campsoon-status')
    if (el) el.textContent = msg
  }
  const reportMatchFailed = (reason: string, attemptKey: string | null) => {
    setStatus('Reservation attempt failed — scanner will keep looking.')
    dbg(`attempt stopped — ${reason}`, { attemptKey })
    chrome.runtime.sendMessage({
      t: RuntimeMessageCode.matchFailed,
      tripId: target.tripId,
      attemptKey,
    })
    setTimeout(() => window.close(), 4000)
  }
  const reportUnavailable = (reason: string) => {
    reportMatchFailed(reason, `${target.resourceId}|${target.checkIn}|${target.checkOut}`)
  }
  const reportRetryableFailure = (reason: string) => {
    reportMatchFailed(reason, null)
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
      reportRetryableFailure('results toggles did not load')
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
  const listReady = await pollUntil(6_000, () => hasListResultOutcome(document.body))
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
    if (hasNoAvailabilityMessage(document.body)) {
      reportUnavailable('BC Parks reports no available campsites')
      return
    }
    setStatus('List view not loading — click "List" → "Campground" → "Details" → "Reserve" manually.')
    dbg('FAILED: panels never appeared. Paste __cs_debug() to developer.')
    reportRetryableFailure('list panels did not load')
    return
  }

  // Step 4: expand panels and click Reserve
  setStatus(`${foundLabel} — clicking Reserve…`)
  const reserveResult = await expandAndReserve(target.noDouble, target.noWalkin)
  dbg('expandAndReserve result', reserveResult)

  if (reserveResult === true) {
    setStatus(target.mode === 'autopay'
      ? 'Reserved — proceeding to payment…'
      : 'Reserved ✓ — complete payment in BC Parks')
  } else {
    // Reserve button not found — likely a panel expansion timing issue, not confirmed unavailable.
    // Do NOT add to attempted — allow retry next scan cycle.
    setStatus('Could not click Reserve — will retry next scan (tab closing in 4s)')
    reportRetryableFailure('no reserve button found, retrying next cycle')
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
async function expandAndReserve(noDouble: boolean, noWalkin: boolean): Promise<true | 'no-reserve-btn'> {
  // Load all panels first (click "View more" if present)
  await loadAllPanels()

  let panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
  if (panels.length === 0) {
    await sleep(2000)
    panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
    if (panels.length === 0) return 'no-reserve-btn'
  }
  dbg('total panels', panels.length)

  let panelsChecked = 0
  const startTime = Date.now()

  // Speed-first: API already proved eligible availability exists, so try the
  // first visible eligible site instead of searching for one exact API site.
  for (const pass of reservePasses()) {
    dbg(`expandAndReserve pass ${pass}`, { totalPanels: panels.length })
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]
      const header = panel.querySelector('mat-expansion-panel-header[role="button"]') as HTMLElement | null
      if (!header) continue

      const alreadyOpen = isExpansionPanelOpen(panel, header)
      if (!alreadyOpen) {
        header.click()
        // Poll for panel content instead of fixed sleep (Angular animation ~300ms)
        await pollUntil(1500, () => isExpansionPanelOpen(panel, header))
        panelsChecked++
      }
      if (isExpansionPanelOpen(panel, header) && !findReserveControl(panel)) {
        await pollUntil(2000, () => !!findReserveControl(panel))
      }

      // Capture the site label before Details/sidebar updates the DOM.
      const summaryText = panel.textContent ?? ''
      const selectedSite = extractSelectedCampsiteName(summaryText, header.textContent ?? '')

      // BC Parks exposes "Details" through the expansion header. Do not click the header again
      // after it is already open, because that collapses the reserve content.
      if (!findReserveControl(panel)) {
        const detailsBtn = findDetailsControl(panel)
        const detailsInHeader = detailsBtn === header || detailsBtn?.closest('mat-expansion-panel-header') === header
        dbg(`panel ${i} Details btn`, {
          found: !!detailsBtn,
          expanded: isExpansionPanelOpen(panel, header),
          detailsInHeader,
        })
        if (detailsBtn && (!isExpansionPanelOpen(panel, header) || !detailsInHeader)) {
          detailsBtn.click()
          await pollUntil(3000, () => isExpansionPanelOpen(panel, header) && !!findReserveControl(panel))
        }
      }

      const reserveBtn = findReserveControl(panel) as HTMLButtonElement | null
      dbg(`panel ${i} reserveBtn`, { found: !!reserveBtn, disabled: reserveBtn?.disabled })

      // Read UI flags from the selected panel only. Other panels may have hidden/inert buttons.
      const contextEl = reserveBtn?.closest('mat-expansion-panel') ?? panel
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
        dbg(`panel ${i} waiting for reserve outcome`, { urlBefore })

        // Poll for outcome (up to 4s):
        //   - URL changed → navigation succeeded, site is ours
        //   - "Cannot Reserve" dialog → site unavailable, dismiss and return
        //   - "not available" / "not reservable" inline text → same
        //   - double-site dialog → cancel and try next panel
        let navigated = false
        let pollEnd = Date.now() + 8000
        while (Date.now() < pollEnd) {
          // Check for any error/info dialog first
          const dialog = document.querySelector('mat-dialog-container, [role="dialog"]')
          if (dialog) {
            const dialogText = (dialog.textContent ?? '').toLowerCase()
            const dialogTitle = (dialog.querySelector('h1,h2,h3,[mat-dialog-title]')?.textContent ?? '').trim()
            const dialogButtons = Array.from(dialog.querySelectorAll('button'))
              .map(button => (button.textContent ?? '').trim().replace(/\s+/g, ' '))
              .filter(Boolean)
            dbg(`panel ${i} dialog seen`, {
              title: dialogTitle,
              buttons: dialogButtons,
              snippet: dialogText.replace(/\s+/g, ' ').substring(0, 160),
            })
            if (dialogText.includes('park alerts')) {
              const acknowledgeBtn = findDialogButton(dialog, ['acknowledge'])
              dbg(`panel ${i} park alerts dialog`, { acknowledgeFound: !!acknowledgeBtn })
              if (acknowledgeBtn) {
                acknowledgeBtn.click()
                dbg(`panel ${i} clicked Park Alerts acknowledge`)
                pollEnd = Math.max(pollEnd, Date.now() + 8000)
                await sleep(500)
                continue
              }
            }
            if (dialogText.includes('double')) {
              dbg(`panel ${i} double-site dialog — cancelling, trying next`)
              const cancelBtn = findDialogButton(dialog, ['cancel'])
              if (cancelBtn) { ;(cancelBtn as HTMLElement).click(); await sleep(500) }
              break  // → continue outer loop (try next panel)
            }
            if (
              dialogText.includes('not available for any of the requested') ||
              dialogText.includes('not reservable') ||
              dialogText.includes('cannot reserve')
            ) {
              dbg(`panel ${i} "Cannot Reserve" dialog — dismissing, trying next`)
              const closeBtn = findDialogButton(dialog, ['ok', 'close', 'dismiss'])
              if (closeBtn) { ;(closeBtn as HTMLElement).click(); await sleep(300) }
              break  // → continue outer loop (try next panel)
            }
          }

          if (window.location.href !== urlBefore) {
            navigated = true
            dbg(`panel ${i} reserve navigation detected`, {
              from: urlBefore,
              to: window.location.href,
            })
            break
          }
          const liveText = (contextEl.textContent ?? '').toLowerCase()
          if (
            liveText.includes('not available for any of the requested') ||
            liveText.includes('not reservable')
          ) {
            dbg(`panel ${i} inline unavailable — trying next`)
            break  // → continue outer loop (try next panel)
          }
          await sleep(200)
        }

        if (navigated) return true
        dbg(`panel ${i} reserve outcome timed out or did not navigate`, {
          currentUrl: window.location.href,
          dialogPresent: !!document.querySelector('mat-dialog-container, [role="dialog"]'),
          elapsedMs: Date.now() - startTime,
        })
        if (!alreadyOpen) { header.click(); await sleep(300) }
        continue  // any failure — try next panel
      }

      if (!alreadyOpen) { header.click(); await sleep(200) }
    }
  }
  dbg('no usable reserve button found in any panel')
  return 'no-reserve-btn'
}

function findDialogButton(dialog: Element, labels: string[]): HTMLElement | null {
  const normalizedLabels = labels.map(label => label.toLowerCase())
  return Array.from(dialog.querySelectorAll('button'))
    .find((button): button is HTMLButtonElement => {
      const text = (button.textContent ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
      return normalizedLabels.includes(text)
    }) ?? null
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




// ── Reservation review page (after clicking Reserve, before payment) ────────

// "Review Reservation Details" page.
// Checking the box and clicking Confirm is REQUIRED to lock the site into the cart.
// For reserve mode: stops after confirm (15-min reserve active, user pays manually).
// For autopay: continues through surcharges → payment.
// Handles reservationmessages page which has two states:
// State 1: "Review Reservation Details" — checkbox + "Confirm reservation details" button
// State 2: Surcharges — Continue button (page stays at same URL after confirming)
async function handleReservationReview(tripId: string, mode: 'reserve' | 'autopay'): Promise<void> {
  injectBanner(`<span style="font-size:18px">🏕</span>
    <span><strong style="color:#22c55e">campsoon</strong> — locking site in cart…</span>
    <span id="campsoon-status" style="margin-left:auto;color:#94a3b8;font-size:11px">Working…</span>`)
  const setStatus = (msg: string) => {
    const el = document.getElementById('campsoon-status')
    if (el) el.textContent = msg
  }
  try {
    await sleep(1500)

    // State 1: Check "All reservation details are correct" checkbox if present.
    // Must click the <label>, not the <input> — mat-checkbox ignores direct input clicks.
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    dbg('checkbox found', !!checkbox)
    if (checkbox && !checkbox.checked) {
      const label = checkbox.id
        ? document.querySelector(`label[for="${checkbox.id}"]`) as HTMLElement | null
        : checkbox.closest('label') as HTMLElement | null
      ;(label ?? checkbox).click()
      dbg('checked acknowledge checkbox', { via: label ? 'label' : 'direct' })
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

    if (mode === 'reserve') {
      // For reserve: site is now locked in cart with 15-min timer — user pays manually
      setStatus('Site reserved for 15 min — complete payment now!')
      dbg('reserved complete — site in cart')
      chrome.runtime.sendMessage({ t: RuntimeMessageCode.bookingReserved, tripId, scanLease: activeTargetSite?.scanLease })
      chrome.storage.local.remove('campOspreyTarget')
      return
    }

    // Autopay: State 2 — surcharges page has "Proceed to checkout" button
    setStatus('Proceeding to checkout…')
    const continueBtn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.textContent ?? '').trim().toLowerCase()
      return t.includes('proceed to checkout') || t.includes('continue') || t.includes('proceed')
    })
    dbg('proceed button found', !!continueBtn)
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

async function waitForBookingConfirmation(timeoutMs = 60_000): Promise<NonNullable<ReturnType<typeof findBookingConfirmation>>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const confirmation = findBookingConfirmation(document, window.location.href)
    if (confirmation) return confirmation
    const failure = findPaymentFailure(document, window.location.href)
    if (failure) throw new Error(failure.message)
    await sleep(250)
  }
  throw new Error('Payment submitted, but BC Parks confirmation page was not detected')
}

// Checkout wizard driver — confirmed selectors from Playwright recording.
// BC Parks checkout is a multi-step wizard; each step is a separate page load.
// We detect which step we're on by looking for the step's unique confirm button.
//
// Recorded step sequence:
//   reservationmessages (handled by handleReservationReview) → Proceed to checkout
//   → Acknowledgements → Account details → Occupant → Party info
//   → Additional info → Add-ons → Payment
async function runCheckout(tripId: string): Promise<void> {
  dbg('runCheckout', { url: window.location.pathname })
  await sleep(1500)  // wait for Angular to render the step

  const reportConfirmedBooking = (confirmationNumber: string) => {
    dbg('booking confirmed', confirmationNumber)
    chrome.runtime.sendMessage({
      t: RuntimeMessageCode.bookingConfirmed,
      tripId,
      scanLease: activeTargetSite?.scanLease,
      confirmationNumber,
      bookingUrl: window.location.href,
      paidAt: new Date().toISOString(),
    })
    chrome.storage.local.remove('campOspreyTarget')
  }

  // Helper: find a button containing the given text (case-insensitive)
  const btn = (text: string): HTMLElement | null =>
    Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').toLowerCase().includes(text.toLowerCase())) as HTMLElement | null

  // Log all button texts visible on the current step (always useful for debugging)
  const allBtnTexts = Array.from(document.querySelectorAll('button'))
    .map(b => (b.textContent ?? '').trim().replace(/\s+/g, ' '))
    .filter(t => t.length > 0 && t.length < 60)
  dbg('buttons on page', allBtnTexts)

  try {
    const existingConfirmation = findBookingConfirmation(document, window.location.href)
    if (existingConfirmation) {
      reportConfirmedBooking(existingConfirmation.confirmationNumber)
      return
    }
    const existingFailure = findPaymentFailure(document, window.location.href)
    if (existingFailure) throw new Error(existingFailure.message)

    // ── Acknowledgements ──────────────────────────────────────────────────
    if (btn('confirm acknowledgements')) {
      const unchecked = Array.from(document.querySelectorAll('input[type="checkbox"]:not(:checked)'))
      dbg('step: acknowledgements', { uncheckedBoxes: unchecked.length })
      unchecked.forEach(cb => {
        const label = (cb as HTMLInputElement).id
          ? document.querySelector(`label[for="${(cb as HTMLInputElement).id}"]`) as HTMLElement | null
          : (cb as HTMLElement).closest('label') as HTMLElement | null
        ;(label ?? cb as HTMLElement).click()
      })
      await sleep(400)
      btn('confirm acknowledgements')!.click()
      dbg('clicked: confirm acknowledgements')
      return
    }

    // ── Account details ───────────────────────────────────────────────────
    if (btn('confirm account details')) {
      dbg('step: account details')
      btn('confirm account details')!.click()
      dbg('clicked: confirm account details')
      return
    }

    // ── Occupant ──────────────────────────────────────────────────────────
    if (btn('confirm occupant')) {
      dbg('step: occupant')
      btn('confirm occupant')!.click()
      dbg('clicked: confirm occupant')
      return
    }

    // ── Party information ─────────────────────────────────────────────────
    if (btn('confirm party information')) {
      dbg('step: party information')
      btn('confirm party information')!.click()
      dbg('clicked: confirm party information')
      return
    }

    // ── Additional information ────────────────────────────────────────────
    if (btn('confirm additional information')) {
      dbg('step: additional information')
      btn('confirm additional information')!.click()
      dbg('clicked: confirm additional information')
      return
    }

    // ── Add-ons ───────────────────────────────────────────────────────────
    if (btn('skip add ons')) {
      dbg('step: add-ons — skipping')
      btn('skip add ons')!.click()
      dbg('clicked: skip add ons')
      return
    }

    // ── Payment ───────────────────────────────────────────────────────────
    // Field IDs confirmed from live DOM inspection (inputs use id, not aria-label):
    //   #cardNumber, #cardHolderName, #cardExpiry, #cardCvv
    //   #street-field-0, #postal-code-field-0
    const applyBtn = btn('apply payment') ?? btn('apply credit card payment')
    if (applyBtn) {
      // Wait up to 15s for Angular to render the card fields
      dbg('step: payment — waiting for card fields')
      await pollUntil(15_000, () => !!document.querySelector('#cardNumber'))
      dbg('card fields ready', { found: !!document.querySelector('#cardNumber') })

      const { payment } = await new Promise<Record<string, unknown>>(resolve =>
        chrome.storage.local.get('payment', resolve)
      ) as { payment: import('../types').PaymentConfig | null }
      if (!payment) throw new Error('No payment info — add it in campsoon Settings.')

      const fill = async (selector: string, value: string) => {
        try {
          await fillInput(selector, value)
          dbg(`filled: ${selector}`)
        } catch {
          dbg(`fill failed: ${selector}`)
          throw new Error(`Could not fill "${selector}" — field not found`)
        }
      }
      await fill('#cardNumber', payment.cardNumber)
      await fill('#cardHolderName', payment.cardHolder)
      await fill('#cardExpiry', payment.cardExpiry)
      await fill('#cardCvv', payment.cardCvv)
      if (payment.billingAddress) await fill('#street-field-0', payment.billingAddress)
      if (payment.billingPostal)  await fill('#postal-code-field-0', payment.billingPostal)
      await sleep(500)

      applyBtn.click()
      dbg('clicked: Apply payment')

      const confirmed = await waitForBookingConfirmation(60_000)
      reportConfirmedBooking(confirmed.confirmationNumber)
      return
    }

    dbg('runCheckout: no matching step — page buttons listed above')
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    dbg('runCheckout error', errorMessage)
    chrome.runtime.sendMessage({ t: RuntimeMessageCode.bookingFailed, tripId, error: errorMessage, scanLease: activeTargetSite?.scanLease })
  }
}
