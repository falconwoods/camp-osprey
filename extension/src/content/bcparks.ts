// Auto-pay content script — only activates when service worker stored autopayTripId

chrome.storage.session.get('autopayTripId', (result: Record<string, unknown>) => {
  const tripId = result['autopayTripId'] as string | undefined
  if (!tripId) return
  runCheckout(tripId)
})

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
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout waiting for ${selector}`)) }, timeoutMs)
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

async function runCheckout(tripId: string): Promise<void> {
  const url = window.location.href

  try {
    if (url.includes('reservationmessages')) {
      // Step 5 — surcharges / reservation messages page
      // TODO: verify selector by pasting the HTML of this step here (right-click → View Page Source)
      // Common BC Parks patterns tried in order:
      await clickWhenReady(
        'button[data-test="continue-button"], .continue-btn, button.mat-raised-button[color="primary"], button[type="submit"]'
      )
      return
    }

    if (url.includes('occupant') || url.includes('campsite-details') || url.includes('step') ) {
      // Step 6 — occupant / booking details page
      // TODO: verify selector by pasting the HTML of this step here
      await clickWhenReady(
        'button[data-test="continue-button"], .continue-btn, button.mat-raised-button[color="primary"], button[type="submit"]'
      )
      return
    }

    if (url.includes('payment') || url.includes('checkout')) {
      // Step 7 — payment page (selectors confirmed from live HTML inspection)
      const result = await new Promise<Record<string, unknown>>(resolve =>
        chrome.storage.local.get('payment', resolve)
      )
      const payment = result['payment'] as { cardNumber: string; cardHolder: string; cardExpiry: string; cardCvv: string } | null
      if (!payment) throw new Error('No payment info configured — add it in CampSniper Settings.')

      await fillInput('#cardNumber', payment.cardNumber)
      await fillInput('#cardHolderName', payment.cardHolder)
      await fillInput('#cardExpiry', payment.cardExpiry)
      await fillInput('#cardCvv', payment.cardCvv)
      await clickWhenReady('#applyPaymentButton')

      // Wait for confirmation
      const confirmEl = await waitForElement(
        '[class*="confirmation"], [class*="booking-ref"], [class*="reference-number"], h1',
        20_000
      )
      const confirmationNumber = confirmEl.textContent?.trim() ?? 'unknown'
      chrome.runtime.sendMessage({ type: 'BOOKING_CONFIRMED', tripId, confirmationNumber })

      // Clear autopayTripId so we don't re-trigger on page reload
      chrome.storage.session.remove('autopayTripId')
    }
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'BOOKING_FAILED', tripId, error: String(err) })
  }
}
