export type ReservePass = 'any'

export function reservePasses(): ReservePass[] {
  return ['any']
}

export function extractCampsiteName(text: string): string {
  return text.match(/Campsite\s*([A-Za-z0-9-]+)/i)?.[1] ?? '?'
}

export function extractSelectedCampsiteName(panelText: string, headerText: string): string {
  const panel = extractCampsiteName(panelText)
  if (panel !== '?') return panel
  return extractCampsiteName(headerText)
}

function normalizedText(el: Element): string {
  return (el.textContent ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isInInertSubtree(el: Element): boolean {
  return !!el.closest('[inert]')
}

function clickableControls(root: ParentNode): HTMLElement[] {
  const selectors = [
    'button',
    'a',
    '[role="button"]',
    '[tabindex]',
    '.mat-button',
    '.mat-mdc-button',
    '.mat-focus-indicator',
  ].join(',')
  return Array.from(root.querySelectorAll(selectors))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter(el => !isInInertSubtree(el))
}

function findControlByText(root: ParentNode, text: string): HTMLElement | null {
  const expected = text.toLowerCase()
  return clickableControls(root).find(el => normalizedText(el) === expected) ?? null
}

export function findDetailsControl(root: ParentNode): HTMLElement | null {
  return findControlByText(root, 'details')
    ?? clickableControls(root).find(el => /\bdetails\b/.test(normalizedText(el))) ?? null
}

export function findReserveControl(root: ParentNode = document): HTMLElement | null {
  const reserveButton = root.querySelector('button.reserve-button') as HTMLElement | null
  if (reserveButton && !isInInertSubtree(reserveButton)) return reserveButton
  return findControlByText(root, 'reserve')
}

export function hasNoAvailabilityMessage(root: ParentNode = document): boolean {
  const text = (root.textContent ?? '').replace(/\s+/g, ' ').toLowerCase()
  return text.includes('no available campsites')
    || text.includes('there are no available campsites')
}

export function hasListResultOutcome(root: ParentNode = document): boolean {
  return root.querySelectorAll('button.map-link-button, mat-expansion-panel.list-entry').length > 0
    || hasNoAvailabilityMessage(root)
}

export function isExpansionPanelOpen(panel: Element, header?: Element | null): boolean {
  return panel.classList.contains('mat-expanded')
    || header?.classList.contains('mat-expanded') === true
    || header?.getAttribute('aria-expanded') === 'true'
}

export interface BookingConfirmation {
  confirmationNumber: string
  referenceElement: Element
}

export interface PaymentFailure {
  message: string
  alertElement: Element
}

export function findBookingConfirmation(
  root: ParentNode = document,
  url: string = window.location.href,
): BookingConfirmation | null {
  if (!url.includes('/create-booking/confirmation/')) return null
  if (!root.querySelector('app-checkout-confirmation')) return null

  const title = root.querySelector('#pageTitle, h1')?.textContent?.trim().toLowerCase()
  if (title !== 'success!') return null

  const confirmationText = (root.querySelector('[id^="confirmationMessage_"]')?.textContent ?? '').toLowerCase()
  if (!confirmationText.includes('successfully made a reservation')) return null

  const referenceElement = root.querySelector('[id^="referenceNumber_"] .success-reference-number, .success-reference-number, [id^="referenceNumber_"]')
  if (!referenceElement) return null

  const referenceText = referenceElement.textContent?.trim().replace(/\s+/g, ' ') ?? ''
  if (!/reservation\s+number/i.test(referenceText)) return null

  const confirmationNumber = referenceText
    .replace(/reservation\s+number\s*:?\s*/i, '')
    .trim()

  return {
    confirmationNumber: confirmationNumber || 'unknown',
    referenceElement,
  }
}

export function findPaymentFailure(
  root: ParentNode = document,
  url: string = window.location.href,
): PaymentFailure | null {
  if (!url.includes('/create-booking/payment/')) return null
  if (!root.querySelector('app-payment')) return null

  const title = root.querySelector('#pageTitle, h1')?.textContent?.trim().toLowerCase()
  if (title !== 'payment') return null

  const alertElement = root.querySelector('[role="alert"].error-box, .alert-box.error-box, [role="alert"]')
  if (!alertElement) return null

  const alertText = alertElement.textContent?.trim().replace(/\s+/g, ' ') ?? ''
  const normalized = alertText.toLowerCase()
  if (!normalized.includes('payment was unsuccessful')) return null
  if (!normalized.includes('please try again')) return null

  return {
    message: alertText || 'Payment was unsuccessful. Please try again.',
    alertElement,
  }
}
