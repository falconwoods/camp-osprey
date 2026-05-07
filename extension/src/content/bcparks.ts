// Content script — injected on all camping.bcparks.ca pages

interface TargetSite {
  resourceId: string
  siteName: string
  sectionName: string
  tripId: string
  mode: 'hold' | 'autopay'
  setAt: number
}

// ── Results page: find & reserve target site ───────────────────────────────

// content scripts can only access chrome.storage.local, not session
chrome.storage.local.get('campSnaperTarget', (result: Record<string, unknown>) => {
  if (chrome.runtime.lastError) return  // storage not available on this page
  const target = result?.['campSnaperTarget'] as TargetSite | undefined
  if (!target) return
  // Ignore stale targets (set more than 5 minutes ago)
  if (Date.now() - target.setAt > 5 * 60 * 1000) return

  const url = window.location.href
  if (url.includes('/create-booking/results')) {
    handleResultsPage(target)
  } else if (url.includes('reservationmessages') || url.includes('payment') || url.includes('checkout')) {
    if (target.mode === 'autopay') runCheckout(target.tripId)
  }
})

function injectBanner(html: string): HTMLElement {
  const existing = document.getElementById('campsniper-banner')
  if (existing) existing.remove()
  const banner = document.createElement('div')
  banner.id = 'campsniper-banner'
  banner.innerHTML = html
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '999999',
    background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif',
    fontSize: '13px', padding: '12px 20px', display: 'flex', alignItems: 'center',
    gap: '12px', boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
  })
  document.body.prepend(banner)
  return banner
}

async function handleResultsPage(target: TargetSite): Promise<void> {
  injectBanner(`
    <span style="font-size:18px">🏕</span>
    <span><strong style="color:#22c55e">CampSniper</strong> found
      <strong>${target.siteName}</strong>
      ${target.sectionName ? `(${target.sectionName})` : ''} available —
      ${target.mode === 'autopay' ? 'auto-clicking Reserve…' : 'click <strong>Reserve</strong> to add it to your cart.'}
    </span>
    <span id="campsniper-status" style="margin-left:auto;color:#94a3b8;font-size:11px">Searching…</span>
  `)

  const status = () => document.getElementById('campsniper-status')

  // Wait for Angular to render the site list (up to 10s)
  const found = await tryClickReserve(target, 10_000)

  if (found) {
    if (status()) status()!.textContent = target.mode === 'autopay' ? 'Reserved — proceeding to payment…' : 'Reserved ✓ — complete payment in BC Parks'
  } else {
    if (status()) status()!.textContent = `Scroll down to find Site ${target.siteName} and click Reserve manually.`
    tryHighlightSite(target.siteName)
  }
}

async function tryClickReserve(target: TargetSite, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // Look for elements that contain the site name text
    const allText = document.querySelectorAll('button, [role="button"], mat-card, .site-card, [class*="site"]')
    for (const el of allText) {
      const text = el.textContent ?? ''
      if (text.includes(target.siteName)) {
        // Try to find a Reserve/Add to Cart button within or near this element
        const btn = findReserveButton(el)
        if (btn) {
          ;(btn as HTMLElement).click()
          return true
        }
      }
    }
    // Also try finding by data attributes (Angular often uses ng-reflect or data attrs)
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
  // Walk up to find the card/section containing this element, then look for Reserve button
  let el: Element | null = container
  for (let i = 0; i < 6 && el; i++) {
    const btn = el.querySelector(
      'button[class*="reserve"], button[class*="Reserve"], button[class*="book"], ' +
      'button[class*="add-to-cart"], [mat-raised-button][color="primary"], ' +
      'button:not([disabled])'
    )
    if (btn) return btn
    el = el.parentElement
  }
  return null
}

function tryHighlightSite(siteName: string): void {
  // Highlight any element visually containing the site name
  document.querySelectorAll('mat-card, .site-card, [class*="campsite"], [class*="resource"]').forEach(el => {
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
      // Step 5 — surcharges page
      // TODO: verify selector by pasting HTML of this step here (right-click → View Page Source)
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
