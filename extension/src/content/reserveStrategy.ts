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

export function isExpansionPanelOpen(panel: Element, header?: Element | null): boolean {
  return panel.classList.contains('mat-expanded')
    || header?.classList.contains('mat-expanded') === true
    || header?.getAttribute('aria-expanded') === 'true'
}
