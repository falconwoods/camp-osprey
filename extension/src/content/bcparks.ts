// Content script — injected on all camping.bcparks.ca pages

// ── Debug logging ──────────────────────────────────────────────────────────
const _dbg: string[] = []
function dbg(msg: string, data?: unknown): void {
  const line = data !== undefined ? `${msg} ${JSON.stringify(data)}` : msg
  _dbg.push(`[${new Date().toLocaleTimeString()}] ${line}`)
  console.log(`[CampSniper] ${line}`)
}
// Expose in DevTools: copy(__cs_debug()) to clipboard
;(window as unknown as Record<string, unknown>)['__cs_debug'] = () => _dbg.join('\n')

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

  // Step 2: detect if showing search form vs results
  const panels0 = document.querySelectorAll('mat-expansion-panel.list-entry')
  const mapMarkers = document.querySelectorAll('mat-button-toggle')
  dbg('after 2s wait', {
    expansionPanels: panels0.length,
    matToggles: mapMarkers.length,
    bodyClasses: document.body.className.substring(0, 60),
  })

  const hasResults = panels0.length > 0
  if (!hasResults) {
    dbg('no results panels — selecting park and clicking Search')
    if (target.parkName) {
      setStatus(`Selecting park "${target.parkName}"…`)
      const selected = await selectParkFromDropdown(target.parkName)
      dbg('park selected', selected)
      if (selected) await sleep(500)
    }
    setStatus('Clicking Search…')
    const clicked = await clickSearchButton()
    dbg('search clicked', clicked)
    if (clicked) {
      setStatus('Waiting for results…')
      await sleep(5000)
    } else {
      setStatus('Search button not found — click Search manually, then Reserve.')
    }
  }

  // Step 3: switch to List view
  setStatus('Switching to list view…')
  const switched = await switchToListView()
  dbg('switched to list view', switched)
  await sleep(2500)

  // Step 4: expand panels and click Reserve
  const panels1 = document.querySelectorAll('mat-expansion-panel.list-entry')
  dbg('panels available for reserve', { count: panels1.length, targetSite: target.siteName })
  setStatus(`Found ${panels1.length} site panels — looking for Reserve…`)
  const reserved = await expandAndReserve(target.siteName)
  dbg('expandAndReserve result', reserved)

  if (reserved) {
    setStatus(target.mode === 'autopay'
      ? 'Reserved — proceeding to payment…'
      : 'Reserved ✓ — complete payment in BC Parks')
  } else {
    setStatus('Click "Details" on a site then click "Reserve" manually.')
    dbg('FAILED — paste __cs_debug() output to CampSniper developer')
  }
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
// Two passes: first try to match the target site name, then fall back to first available.
async function expandAndReserve(targetSiteName: string): Promise<boolean> {
  let panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
  if (panels.length === 0) {
    await sleep(2000)
    panels = Array.from(document.querySelectorAll('mat-expansion-panel.list-entry'))
    if (panels.length === 0) return false
  }

  // Pass 0: try panel matching target site name (check text after expand)
  // Pass 1: try any panel with a Reserve button
  for (const pass of [0, 1]) {
    dbg(`expandAndReserve pass ${pass}`, { totalPanels: panels.length })
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]
      const header = panel.querySelector('mat-expansion-panel-header[role="button"]') as HTMLElement | null
      dbg(`panel ${i}`, {
        hasHeader: !!header,
        cls: panel.className.substring(0, 60),
        headerCls: header?.className.substring(0, 60) ?? 'n/a',
      })
      if (!header) continue

      const alreadyOpen = panel.classList.contains('mat-expanded')
      if (!alreadyOpen) { header.click(); await sleep(600) }

      if (pass === 0) {
        const siteRegex = new RegExp(`(^|\\s|Site\\s*)${targetSiteName}(\\s|$)`, 'i')
        const matches = siteRegex.test(panel.textContent ?? '')
        dbg(`panel ${i} site match`, { targetSiteName, matches })
        if (!matches) {
          if (!alreadyOpen) { header.click(); await sleep(300) }
          continue
        }
      }

      const reserveBtn = panel.querySelector('button.reserve-button') as HTMLButtonElement | null
      const allBtns = Array.from(panel.querySelectorAll('button')).map(b => ({
        text: b.textContent?.trim().substring(0, 30),
        cls: b.className.substring(0, 50),
        disabled: b.disabled,
      }))
      dbg(`panel ${i} buttons`, allBtns)
      dbg(`panel ${i} reserveBtn`, { found: !!reserveBtn, disabled: reserveBtn?.disabled })

      if (reserveBtn && !reserveBtn.disabled) {
        reserveBtn.click()
        dbg(`clicked reserve on panel ${i}`)
        return true
      }

      if (!alreadyOpen) { header.click(); await sleep(300) }
    }
  }
  dbg('no reserve button found in any panel')
  return false
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

// Click the Search button — confirmed class: btn-update-search btn-search
async function clickSearchButton(): Promise<boolean> {
  const btn = document.querySelector('button.btn-search, button.btn-update-search') as HTMLElement | null
  if (btn) { btn.click(); return true }
  // Fallback: by text
  for (const b of document.querySelectorAll('button')) {
    if ((b.textContent ?? '').trim().toLowerCase() === 'search') {
      ;(b as HTMLElement).click(); return true
    }
  }
  return false
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
