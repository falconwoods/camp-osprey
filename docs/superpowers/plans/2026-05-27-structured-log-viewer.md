# Structured Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Logs tab with compact toolbar controls, structured local log entries, level filtering, auto-scroll, colored rows, and JSONL export.

**Architecture:** Add structured log types in `types.ts`, make `storage.ts` write only valid structured entries, move log formatting/rendering helpers into `debugLog.ts`, and wire a new Logs tab into the existing Options page. Update background scanner log calls from free-form strings to stable structured events.

**Tech Stack:** Chrome extension, TypeScript, Vite, Vitest, jsdom, `chrome.storage.local`.

---

## File Structure

- Modify `extension/src/types.ts`: define `LogLevel`, `BookingStatus`, `DebugLogEntry`, and change `StorageData.debugLog` to `DebugLogEntry[]`.
- Modify `extension/src/storage.ts`: change `addDebugLog` to structured input, drop old string entries on write, preserve queueing and cap behavior.
- Modify `extension/src/debugLog.ts`: replace plain text formatting with structured helpers for filtering, rendering, metadata formatting, and JSONL export.
- Modify `extension/options/index.html`: add Logs tab markup, compact toolbar, level controls, and full-height viewer styles.
- Modify `extension/src/options/index.ts`: add `logs` tab routing, bind level filters, auto-scroll, copy JSONL, clear, and rendering.
- Modify `extension/tests/storage.test.ts`: update storage tests for structured entries and old-log discard.
- Modify `extension/tests/debugLog.test.ts`: test filtering, HTML rendering, JSONL export, escaping, and empty state.
- Modify `extension/tests/options-auth.test.ts`: expand fixture to include Logs tab DOM and add behavior tests for tab selection, filtering, clear, and copy.
- Modify `extension/tests/background/index.test.ts`: update log assertions from string matching to structured event assertions.
- Modify `extension/src/background/index.ts`: replace important `addDebugLog(string)` calls with structured event objects.

## Task 1: Structured Log Types And Storage

**Files:**
- Modify: `extension/src/types.ts`
- Modify: `extension/src/storage.ts`
- Test: `extension/tests/storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

In `extension/tests/storage.test.ts`, update the import:

```ts
import { addDebugLog, getStorage, saveTrips, updateTrip, MAX_DEBUG_LOG_ENTRIES } from '../src/storage'
import type { DebugLogEntry } from '../src/types'
```

Replace the `describe('addDebugLog', ...)` block with:

```ts
describe('addDebugLog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function entry(i: number): DebugLogEntry {
    return {
      ts: `2026-05-27T00:00:${String(i).padStart(2, '0')}.000Z`,
      level: 'info',
      event: 'scan_cycle_started',
      message: `entry ${i}`,
    }
  }

  it('keeps more than 30 structured entries so the scan history is not truncated too aggressively', async () => {
    const existing = Array.from({ length: 40 }, (_, i) => entry(i))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: existing }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'info', event: 'site_found', message: 'latest' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(41)
    expect(setCall.debugLog[0]).toEqual(existing[0])
    expect(setCall.debugLog[40]).toEqual(expect.objectContaining({
      level: 'info',
      event: 'site_found',
      message: 'latest',
      ts: expect.any(String),
    }))
  })

  it('keeps overnight-sized local logs instead of trimming at 500 entries', async () => {
    const existing = Array.from({ length: 800 }, (_, i) => entry(i))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: existing }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'debug', event: 'availability_result', message: 'latest' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(801)
    expect(setCall.debugLog[0]).toEqual(existing[0])
    expect(setCall.debugLog[800]).toEqual(expect.objectContaining({ event: 'availability_result' }))
  })

  it('keeps a larger local log history cap for long debug runs', async () => {
    expect(MAX_DEBUG_LOG_ENTRIES).toBe(100_000)
  })

  it('adds an ISO timestamp to each structured log entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T17:42:05-07:00'))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: [] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({
      level: 'info',
      event: 'site_found',
      message: 'Found reservable site',
      parkName: 'Alice Lake',
      siteName: '67',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      foundAt: '2026-05-27T00:42:05.000Z',
      bookingDate: '2026-05-27T00:42:05.000Z',
      status: 'found',
    })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog[0]).toEqual({
      ts: '2026-05-27T00:42:05.000Z',
      level: 'info',
      event: 'site_found',
      message: 'Found reservable site',
      parkName: 'Alice Lake',
      siteName: '67',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      foundAt: '2026-05-27T00:42:05.000Z',
      bookingDate: '2026-05-27T00:42:05.000Z',
      status: 'found',
    })
  })

  it('drops old string logs before writing the first structured entry', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: ['old string log'] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'warning', event: 'match_failed', message: 'Site unavailable' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(1)
    expect(setCall.debugLog[0]).toEqual(expect.objectContaining({
      level: 'warning',
      event: 'match_failed',
      message: 'Site unavailable',
    }))
  })

  it('serializes concurrent structured writes so log entries are not lost', async () => {
    let stored: Record<string, unknown> = { debugLog: [] }
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })

    await Promise.all([
      addDebugLog({ level: 'info', event: 'first_event', message: 'first' }),
      addDebugLog({ level: 'error', event: 'second_event', message: 'second' }),
    ])

    expect(stored.debugLog).toHaveLength(2)
    expect(stored.debugLog).toEqual([
      expect.objectContaining({ event: 'first_event', message: 'first' }),
      expect.objectContaining({ event: 'second_event', message: 'second' }),
    ])
  })
})
```

- [ ] **Step 2: Run storage tests to verify failure**

Run:

```bash
cd extension && npm test -- tests/storage.test.ts
```

Expected: FAIL because `DebugLogEntry` does not exist and `addDebugLog` still expects a string.

- [ ] **Step 3: Add structured log types**

In `extension/src/types.ts`, add these definitions before `export interface StorageData`:

```ts
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type BookingStatus = 'found' | 'reserved' | 'paid' | 'failed'

export interface DebugLogEntry {
  ts: string
  level: LogLevel
  event: string
  message: string
  tripId?: string
  tripName?: string
  parkName?: string
  siteName?: string
  checkIn?: string
  checkOut?: string
  foundAt?: string
  reservedAt?: string
  paidAt?: string
  bookingDate?: string
  status?: BookingStatus
  error?: string
  metadata?: Record<string, unknown>
}
```

Then change `StorageData.debugLog`:

```ts
export interface StorageData {
  trips: Trip[]
  payment: PaymentConfig | null
  settings: Settings
  debugLog: DebugLogEntry[]
  auth: AuthState
}
```

- [ ] **Step 4: Implement structured storage writes**

In `extension/src/storage.ts`, update the type import:

```ts
import type { AuthState, StorageData, Trip, PaymentConfig, Settings, DebugLogEntry } from './types'
```

Add this helper near `formatDateTime`:

```ts
function isDebugLogEntry(value: unknown): value is DebugLogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<DebugLogEntry>
  return typeof entry.ts === 'string' &&
    (entry.level === 'debug' || entry.level === 'info' || entry.level === 'warning' || entry.level === 'error') &&
    typeof entry.event === 'string' &&
    typeof entry.message === 'string'
}
```

Replace `addDebugLog` with:

```ts
export async function addDebugLog(entry: Omit<DebugLogEntry, 'ts'> & { ts?: string }): Promise<void> {
  const write = async () => {
    const { debugLog } = await getStorage()
    const existing = Array.isArray(debugLog) ? debugLog.filter(isDebugLogEntry) : []
    const structuredEntry: DebugLogEntry = {
      ...entry,
      ts: entry.ts ?? new Date().toISOString(),
    }
    const newLog = [...existing, structuredEntry].slice(-MAX_DEBUG_LOG_ENTRIES)
    await promisify<void>(cb => chrome.storage.local.set({ debugLog: newLog }, cb))
  }
  const result = debugLogWriteQueue.then(write, write)
  debugLogWriteQueue = result.catch(() => undefined)
  await result
}
```

- [ ] **Step 5: Run storage tests to verify pass**

Run:

```bash
cd extension && npm test -- tests/storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/types.ts extension/src/storage.ts extension/tests/storage.test.ts
git commit -m "feat(extension): store structured scan logs"
```

## Task 2: Structured Log Formatting Helpers

**Files:**
- Modify: `extension/src/debugLog.ts`
- Test: `extension/tests/debugLog.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Replace `extension/tests/debugLog.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import type { DebugLogEntry, LogLevel } from '../src/types'
import {
  EMPTY_DEBUG_LOG_MESSAGE,
  filterDebugLog,
  formatDebugLogAsJsonl,
  renderDebugLogRows,
} from '../src/debugLog'

function entry(overrides: Partial<DebugLogEntry> = {}): DebugLogEntry {
  return {
    ts: '2026-05-27T00:42:05.000Z',
    level: 'info',
    event: 'scan_cycle_started',
    message: 'Scan started',
    ...overrides,
  }
}

describe('structured debug log helpers', () => {
  it('filters entries by selected levels while keeping original order', () => {
    const entries = [
      entry({ level: 'debug', event: 'park_checked' }),
      entry({ level: 'info', event: 'site_found' }),
      entry({ level: 'error', event: 'booking_failed' }),
    ]
    const levels = new Set<LogLevel>(['info', 'error'])

    expect(filterDebugLog(entries, levels).map(e => e.event)).toEqual(['site_found', 'booking_failed'])
  })

  it('renders an empty state when no entries match', () => {
    expect(renderDebugLogRows([], new Set<LogLevel>(['debug']))).toContain(EMPTY_DEBUG_LOG_MESSAGE)
  })

  it('escapes user-controlled strings while rendering metadata', () => {
    const html = renderDebugLogRows([
      entry({
        level: 'error',
        event: 'booking_failed',
        message: '<script>alert(1)</script>',
        tripName: '<b>Trip</b>',
        error: 'card <declined>',
        metadata: { attemptKey: 'p1|2026-07-04|2026-07-05' },
      }),
    ], new Set<LogLevel>(['error']))

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;Trip&lt;/b&gt;')
    expect(html).toContain('attemptKey=&quot;p1|2026-07-04|2026-07-05&quot;')
    expect(html).not.toContain('<script>')
  })

  it('adds milestone row classes for booking events', () => {
    const html = renderDebugLogRows([
      entry({ event: 'site_found', status: 'found' }),
      entry({ event: 'booking_paid', status: 'paid' }),
      entry({ level: 'error', event: 'booking_failed', status: 'failed' }),
    ], new Set<LogLevel>(['info', 'error']))

    expect(html).toContain('log-row--found')
    expect(html).toContain('log-row--paid')
    expect(html).toContain('log-row--failed')
  })

  it('exports filtered entries as JSONL', () => {
    const entries = [
      entry({ level: 'debug', event: 'park_checked' }),
      entry({
        level: 'info',
        event: 'site_found',
        message: 'Found site',
        bookingDate: '2026-05-27T00:42:05.000Z',
        checkIn: '2026-07-04',
        checkOut: '2026-07-05',
      }),
    ]

    expect(formatDebugLogAsJsonl(entries, new Set<LogLevel>(['info']))).toBe(JSON.stringify(entries[1]))
  })
})
```

- [ ] **Step 2: Run formatter tests to verify failure**

Run:

```bash
cd extension && npm test -- tests/debugLog.test.ts
```

Expected: FAIL because the structured helper exports do not exist.

- [ ] **Step 3: Implement structured helpers**

Replace `extension/src/debugLog.ts` with:

```ts
import type { DebugLogEntry, LogLevel } from './types'

export const EMPTY_DEBUG_LOG_MESSAGE = 'No log entries match the selected filters.'

export const ALL_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error']

export function filterDebugLog(entries: DebugLogEntry[], levels: Set<LogLevel>): DebugLogEntry[] {
  return entries.filter(entry => levels.has(entry.level))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMetadata(entry: DebugLogEntry): string {
  const metadata: Record<string, unknown> = {
    tripName: entry.tripName,
    parkName: entry.parkName,
    siteName: entry.siteName,
    checkIn: entry.checkIn,
    checkOut: entry.checkOut,
    bookingDate: entry.bookingDate,
    status: entry.status,
    error: entry.error,
    ...(entry.metadata ?? {}),
  }
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(' ')
}

function rowClass(entry: DebugLogEntry): string {
  const classes = [`log-row`, `log-row--${entry.level}`]
  if (entry.event === 'site_found' || entry.status === 'found') classes.push('log-row--found')
  if (entry.event === 'booking_reserved' || entry.status === 'reserved') classes.push('log-row--reserved')
  if (entry.event === 'booking_paid' || entry.status === 'paid') classes.push('log-row--paid')
  if (entry.event === 'booking_failed' || entry.status === 'failed') classes.push('log-row--failed')
  return classes.join(' ')
}

export function renderDebugLogRows(entries: DebugLogEntry[], levels: Set<LogLevel>): string {
  const filtered = filterDebugLog(entries, levels)
  if (filtered.length === 0) {
    return `<div class="log-empty">${EMPTY_DEBUG_LOG_MESSAGE}</div>`
  }
  return filtered.map(entry => {
    const metadata = formatMetadata(entry)
    const detail = [entry.message, metadata].filter(Boolean).join(' ')
    return `<div class="${rowClass(entry)}">
      <span class="log-cell log-time">${escapeHtml(entry.ts)}</span>
      <span class="log-cell log-level">${escapeHtml(entry.level.toUpperCase())}</span>
      <span class="log-cell log-event">${escapeHtml(entry.event)}</span>
      <span class="log-cell log-message">${escapeHtml(detail)}</span>
    </div>`
  }).join('')
}

export function formatDebugLogAsJsonl(entries: DebugLogEntry[], levels: Set<LogLevel>): string {
  return filterDebugLog(entries, levels)
    .map(entry => JSON.stringify(entry))
    .join('\n')
}
```

- [ ] **Step 4: Run formatter tests to verify pass**

Run:

```bash
cd extension && npm test -- tests/debugLog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/debugLog.ts extension/tests/debugLog.test.ts
git commit -m "feat(extension): format structured scan logs"
```

## Task 3: Logs Tab UI

**Files:**
- Modify: `extension/options/index.html`
- Modify: `extension/src/options/index.ts`
- Test: `extension/tests/options-auth.test.ts`

- [ ] **Step 1: Extend the Options test fixture**

In `extension/tests/options-auth.test.ts`, update the import:

```ts
import type { DebugLogEntry, Trip } from '../src/types'
```

In `renderFixture`, add the logs tab button after the account tab:

```html
<div class="tab" data-tab="logs"></div>
```

Add this Logs tab panel after `tab-account`:

```html
<div id="tab-logs" class="hidden">
  <input id="log-autoscroll" type="checkbox" checked>
  <button class="log-level-btn active" data-log-level="debug"></button>
  <button class="log-level-btn active" data-log-level="info"></button>
  <button class="log-level-btn active" data-log-level="warning"></button>
  <button class="log-level-btn active" data-log-level="error"></button>
  <button id="copy-log-jsonl-btn"></button>
  <button id="clear-log-btn"></button>
  <div id="debug-log-box"></div>
</div>
```

Remove the old fixture placement of `debug-log-box`, `clear-log-btn`, and `copy-log-btn` from the Settings area.

- [ ] **Step 2: Write failing Logs tab tests**

Add this helper near `trip()`:

```ts
function logEntry(overrides: Partial<DebugLogEntry> = {}): DebugLogEntry {
  return {
    ts: '2026-05-27T00:42:05.000Z',
    level: 'info',
    event: 'site_found',
    message: 'Found site',
    ...overrides,
  }
}
```

Add these tests to the existing `describe('options auth gate', ...)` block:

```ts
it('selects Logs tab from hash and renders structured log rows', async () => {
  location.hash = '#logs'
  await saveTrips([trip()])
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
    trips: [trip()],
    debugLog: [
      logEntry({ level: 'debug', event: 'park_checked', message: 'Checking park' }),
      logEntry({ level: 'error', event: 'booking_failed', message: 'Payment failed', error: 'card declined' }),
    ],
    settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto' },
    auth: { token: null, user: null, lastEmail: null },
  }))

  await import('../src/options/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(document.querySelector('[data-tab="logs"]')!.classList.contains('active')).toBe(true)
  expect(document.getElementById('tab-logs')!.classList.contains('hidden')).toBe(false)
  expect(document.getElementById('debug-log-box')!.textContent).toContain('park_checked')
  expect(document.getElementById('debug-log-box')!.textContent).toContain('booking_failed')
})

it('filters logs by level when a level chip is toggled', async () => {
  location.hash = '#logs'
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
    trips: [trip()],
    debugLog: [
      logEntry({ level: 'debug', event: 'park_checked', message: 'Checking park' }),
      logEntry({ level: 'error', event: 'booking_failed', message: 'Payment failed' }),
    ],
    settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto' },
    auth: { token: null, user: null, lastEmail: null },
  }))

  await import('../src/options/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  document.querySelector<HTMLButtonElement>('[data-log-level="debug"]')!.click()
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(document.getElementById('debug-log-box')!.textContent).not.toContain('park_checked')
  expect(document.getElementById('debug-log-box')!.textContent).toContain('booking_failed')
})

it('copies filtered logs as JSONL', async () => {
  location.hash = '#logs'
  const writeText = vi.fn(async () => undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
    trips: [trip()],
    debugLog: [
      logEntry({ level: 'debug', event: 'park_checked', message: 'Checking park' }),
      logEntry({ level: 'info', event: 'site_found', message: 'Found site' }),
    ],
    settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto' },
    auth: { token: null, user: null, lastEmail: null },
  }))

  await import('../src/options/index')
  await new Promise(resolve => setTimeout(resolve, 0))
  document.querySelector<HTMLButtonElement>('[data-log-level="debug"]')!.click()
  document.getElementById('copy-log-jsonl-btn')!.click()
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(writeText).toHaveBeenCalledWith(JSON.stringify(logEntry({ level: 'info', event: 'site_found', message: 'Found site' })))
})
```

- [ ] **Step 3: Run Options tests to verify failure**

Run:

```bash
cd extension && npm test -- tests/options-auth.test.ts
```

Expected: FAIL because the Logs tab and new copy button are not implemented.

- [ ] **Step 4: Add Logs tab HTML and compact toolbar styles**

In `extension/options/index.html`, add the tab:

```html
<div class="tab" data-tab="logs">Logs</div>
```

Remove the old `#debug-section` log box from Settings, keeping only the `Debug mode` checkbox.

Add this panel after `tab-account`:

```html
<div id="tab-logs" class="hidden">
  <div class="log-panel">
    <div class="log-toolbar">
      <div>
        <div class="section-label" style="margin-bottom:2px">Scan Log</div>
        <div class="hint">Structured local logs. Newest entries stay at the bottom.</div>
      </div>
      <div class="log-actions">
        <label class="checkbox-label log-autoscroll-label">
          <input type="checkbox" id="log-autoscroll" checked>
          Auto scroll
        </label>
        <button class="btn-secondary" id="copy-log-jsonl-btn">Copy JSONL</button>
        <button class="btn-secondary" id="clear-log-btn">Clear</button>
      </div>
    </div>
    <div class="log-filters" aria-label="Log level filters">
      <button class="log-level-btn active" data-log-level="debug">Debug</button>
      <button class="log-level-btn active" data-log-level="info">Info</button>
      <button class="log-level-btn active" data-log-level="warning">Warning</button>
      <button class="log-level-btn active" data-log-level="error">Error</button>
    </div>
    <div class="debug-log-box" id="debug-log-box"></div>
  </div>
</div>
```

Replace the old `.debug-log-box` CSS with:

```css
.log-panel { display: flex; flex-direction: column; min-height: 620px; }
.log-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
.log-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.log-autoscroll-label { width: auto; white-space: nowrap; }
.log-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.log-level-btn { border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); border-radius: 5px; padding: 5px 10px; font-size: 11px; cursor: pointer; }
.log-level-btn.active[data-log-level="debug"] { border-color: #38bdf8; color: #0284c7; background: rgba(56,189,248,0.12); }
.log-level-btn.active[data-log-level="info"] { border-color: var(--green); color: var(--green); background: var(--green-subtle); }
.log-level-btn.active[data-log-level="warning"] { border-color: var(--amber); color: var(--amber); background: var(--amber-subtle); }
.log-level-btn.active[data-log-level="error"] { border-color: var(--red); color: var(--red); background: rgba(239,68,68,0.08); }
.debug-log-box { background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-subtle); height: min(640px, calc(100vh - 250px)); min-height: 420px; overflow-y: auto; line-height: 1.6; }
.log-row { display: grid; grid-template-columns: 190px 74px 160px minmax(260px, 1fr); gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); align-items: start; }
.log-row--debug .log-level { color: #0284c7; }
.log-row--info .log-level { color: var(--green); }
.log-row--warning { background: var(--amber-subtle); }
.log-row--warning .log-level { color: var(--amber); }
.log-row--error, .log-row--failed { background: rgba(239,68,68,0.08); }
.log-row--error .log-level, .log-row--failed .log-level { color: var(--red); }
.log-row--found, .log-row--reserved, .log-row--paid { background: var(--green-subtle); }
.log-cell { min-width: 0; overflow-wrap: anywhere; }
.log-time { color: var(--text-dim); }
.log-event { color: var(--text); font-weight: 600; }
.log-message { color: var(--text-subtle); }
.log-empty { padding: 18px; color: var(--text-muted); font-size: 12px; }
@media (max-width: 720px) {
  .log-toolbar { align-items: flex-start; flex-direction: column; }
  .log-row { grid-template-columns: 1fr; gap: 2px; }
}
```

- [ ] **Step 5: Wire Logs tab behavior**

In `extension/src/options/index.ts`, update imports:

```ts
import { ALL_LOG_LEVELS, formatDebugLogAsJsonl, renderDebugLogRows } from '../debugLog'
import type { Trip, DateRange, Park, Theme, LogLevel } from '../types'
```

Replace tab types:

```ts
type OptionsTab = 'trips' | 'payment' | 'settings' | 'account' | 'logs'
const OPTIONS_TABS: OptionsTab[] = ['trips', 'payment', 'settings', 'account', 'logs']
```

In `selectTab`, add:

```ts
document.getElementById('tab-logs')!.classList.toggle('hidden', name !== 'logs')
if (name === 'logs') void refreshDebugLog()
```

Add log state near Settings code:

```ts
let selectedLogLevels = new Set<LogLevel>(ALL_LOG_LEVELS)
let logAutoScroll = true
```

Replace the old `refreshDebugLog`, clear, and copy handlers with:

```ts
async function refreshDebugLog() {
  const { debugLog } = await getStorage()
  const box = document.getElementById('debug-log-box')
  if (!box) return
  box.innerHTML = renderDebugLogRows(debugLog, selectedLogLevels)
  if (logAutoScroll) box.scrollTop = box.scrollHeight
}

document.querySelectorAll('.log-level-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const level = (btn as HTMLElement).dataset['logLevel'] as LogLevel
    if (selectedLogLevels.has(level)) selectedLogLevels.delete(level)
    else selectedLogLevels.add(level)
    btn.classList.toggle('active', selectedLogLevels.has(level))
    await refreshDebugLog()
  })
})

document.getElementById('log-autoscroll')!.addEventListener('change', () => {
  logAutoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement).checked
  if (logAutoScroll) {
    const box = document.getElementById('debug-log-box')
    if (box) box.scrollTop = box.scrollHeight
  }
})

document.getElementById('clear-log-btn')!.addEventListener('click', async () => {
  await clearDebugLog()
  await refreshDebugLog()
})

document.getElementById('copy-log-jsonl-btn')!.addEventListener('click', async () => {
  const { debugLog } = await getStorage()
  const text = formatDebugLogAsJsonl(debugLog, selectedLogLevels)
  await navigator.clipboard.writeText(text)
  const btn = document.getElementById('copy-log-jsonl-btn')!
  const original = btn.textContent
  btn.textContent = 'Copied'
  window.setTimeout(() => { btn.textContent = original }, 1200)
})
```

In `loadSettingsForm`, remove:

```ts
document.getElementById('debug-section')!.classList.toggle('hidden', !debugEl.checked)
```

Replace the `debug-mode` change listener with a no-op UI save-only listener or remove it entirely:

```ts
document.getElementById('debug-mode')!.addEventListener('change', () => undefined)
```

- [ ] **Step 6: Run Options tests to verify pass**

Run:

```bash
cd extension && npm test -- tests/options-auth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/options/index.html extension/src/options/index.ts extension/tests/options-auth.test.ts
git commit -m "feat(extension): add structured log viewer tab"
```

## Task 4: Background Structured Log Events

**Files:**
- Modify: `extension/src/background/index.ts`
- Test: `extension/tests/background/index.test.ts`

- [ ] **Step 1: Update failing background log assertions**

In `extension/tests/background/index.test.ts`, replace string-based log expectations with structured event expectations:

```ts
expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
  level: 'warning',
  event: 'active_match_suppressed',
  tripId: trip.id,
  tripName: trip.name,
}))
```

For hold success:

```ts
expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
  level: 'info',
  event: 'booking_reserved',
  tripId: trip.id,
  tripName: trip.name,
  status: 'reserved',
  reservedAt: expect.any(String),
  bookingDate: expect.any(String),
}))
```

For server reporting:

```ts
expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
  level: 'info',
  event: 'server_result_reported',
  tripId: trip.id,
  tripName: trip.name,
  parkName: 'Park 1',
  siteName: 'A1',
}))
expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
  level: 'info',
  event: 'server_email_sent',
  tripId: trip.id,
  tripName: trip.name,
}))
```

For paid booking:

```ts
expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
  level: 'info',
  event: 'booking_paid',
  tripId: trip.id,
  tripName: trip.name,
  status: 'paid',
  paidAt: expect.any(String),
  bookingDate: expect.any(String),
  metadata: expect.objectContaining({ confirmationNumber: 'ABC123' }),
}))
```

Add a booking failure assertion:

```ts
expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
  level: 'error',
  event: 'booking_failed',
  tripId: trip.id,
  tripName: trip.name,
  status: 'failed',
  error: 'card declined',
  bookingDate: expect.any(String),
}))
```

- [ ] **Step 2: Run background tests to verify failure**

Run:

```bash
cd extension && npm test -- tests/background/index.test.ts
```

Expected: FAIL because `background/index.ts` still calls `addDebugLog` with strings.

- [ ] **Step 3: Add small logging helper in background scanner**

In `extension/src/background/index.ts`, update the type import:

```ts
import type { AvailableSite, DebugLogEntry, MatchedSite, Trip } from '../types'
```

Add this helper after constants:

```ts
function logEntry(entry: Omit<DebugLogEntry, 'ts'> & { ts?: string }): Promise<void> {
  return addDebugLog(entry)
}
```

- [ ] **Step 4: Replace important scanner log calls**

Use structured calls for high-value events first.

For raw availability:

```ts
provider.onAvailabilityRaw = (siteId, siteName, daily) => {
  void logEntry({
    level: 'debug',
    event: 'availability_raw',
    message: 'Raw availability response',
    siteName,
    metadata: { siteId, daily },
  })
}
```

For scan skipped:

```ts
if (settings.debugMode) await logEntry({
  level: 'debug',
  event: 'scan_skipped',
  message: 'Previous scan still running',
})
```

For cycle start:

```ts
await logEntry({
  level: 'info',
  event: 'scan_cycle_started',
  message: 'Alarm fired',
  metadata: { scanningTripCount: scanningTrips.length },
})
```

For trip scan start:

```ts
await logEntry({
  level: 'debug',
  event: 'trip_scan_started',
  message: 'Scanning trip',
  tripId: trip.id,
  tripName: trip.name,
  metadata: {
    parkCount: trip.parks.length,
    parkNames,
    dateRangeCount: trip.dateRanges.length,
  },
})
```

For park check:

```ts
if (debug) await logEntry({
  level: 'debug',
  event: 'park_checked',
  message: 'Checking park date window',
  tripId: trip.id,
  tripName: trip.name,
  parkName,
  checkIn: ci,
  checkOut: co,
})
```

For availability results:

```ts
await logEntry({
  level: results.length > 0 ? 'info' : 'debug',
  event: 'availability_result',
  message: `${results.length} available site(s)`,
  tripId: trip.id,
  tripName: trip.name,
  parkName,
  checkIn: ci,
  checkOut: co,
  metadata: {
    availableCount: results.length,
    sites: results.map(s => ({
      sectionName: s.sectionName || 'no section',
      siteName: s.siteName,
      resourceId: s.resourceId,
      isWalkin: s.isWalkin,
      isDouble: s.isDouble,
    })),
  },
})
```

For site found in `handleMatch`:

```ts
await logEntry({
  level: 'info',
  event: 'site_found',
  message: 'Found reservable site',
  tripId: trip.id,
  tripName: trip.name,
  parkName: matchedSite.parkName,
  siteName: matchedSite.siteName,
  checkIn: site.checkIn,
  checkOut: site.checkOut,
  foundAt,
  bookingDate: foundAt,
  status: 'found',
  metadata: { availableCount },
})
```

For duplicate active match:

```ts
await logEntry({
  level: 'warning',
  event: 'active_match_suppressed',
  message: 'Already handling active match; suppressing duplicate tab and notification',
  tripId: trip.id,
  tripName: trip.name,
  parkName: site.campgroundName || site.campgroundId,
  siteName: site.siteName,
  checkIn: site.checkIn,
  checkOut: site.checkOut,
  metadata: { resourceId: site.resourceId },
})
```

For reservation tab opened:

```ts
await logEntry({
  level: 'info',
  event: 'reservation_tab_opened',
  message: trip.mode === 'autopay' ? 'Reservation tab opened for auto-pay' : 'Reservation tab opened',
  tripId: trip.id,
  tripName: trip.name,
  parkName: matchedSite.parkName,
  siteName: matchedSite.siteName,
  checkIn: site.checkIn,
  checkOut: site.checkOut,
  status: 'found',
})
```

For match failed:

```ts
void logEntry({
  level: 'warning',
  event: 'match_failed',
  message: msg.attemptKey ? 'Match failed; marked attempted' : 'Match failed; keeping match locked',
  tripId: trip.id,
  tripName: trip.name,
  metadata: { attemptKey: msg.attemptKey ?? null },
})
```

For booking reserved:

```ts
void logEntry({
  level: 'info',
  event: 'booking_reserved',
  message: 'Reservation held',
  tripId: msg.tripId,
  tripName: trip?.name,
  parkName: match?.parkName,
  siteName: match?.siteName,
  checkIn: match?.checkIn,
  checkOut: match?.checkOut,
  reservedAt,
  bookingDate: reservedAt,
  status: 'reserved',
})
```

For server result and email:

```ts
await logEntry({
  level: 'info',
  event: 'server_result_reported',
  message: 'Reporting reservation result to server',
  tripId: msg.tripId!,
  tripName: trip.name,
  parkName: match.parkName,
  siteName: match.siteName,
  checkIn: match.checkIn,
  checkOut: match.checkOut,
  status: 'reserved',
})
await logEntry({
  level: result.emailSent ? 'info' : 'warning',
  event: result.emailSent ? 'server_email_sent' : 'server_email_not_sent',
  message: result.emailSent ? 'Reservation email sent' : 'Reservation email not sent',
  tripId: msg.tripId!,
  tripName: trip.name,
  parkName: match.parkName,
  siteName: match.siteName,
})
```

For server email failure:

```ts
await logEntry({
  level: 'error',
  event: 'server_email_failed',
  message: 'Reservation email failed',
  tripId: msg.tripId!,
  tripName: trip?.name,
  parkName: match.parkName,
  siteName: match.siteName,
  error: err instanceof Error ? err.message : String(err),
})
```

For booking paid:

```ts
void logEntry({
  level: 'info',
  event: 'booking_paid',
  message: 'Booking paid',
  tripId: msg.tripId,
  tripName: trip?.name,
  parkName: m?.parkName,
  siteName: m?.siteName,
  checkIn: m?.checkIn,
  checkOut: m?.checkOut,
  paidAt,
  bookingDate: paidAt,
  status: 'paid',
  metadata: { confirmationNumber: msg.confirmationNumber ?? 'unknown' },
})
```

For booking failed:

```ts
void logEntry({
  level: 'error',
  event: 'booking_failed',
  message: 'Booking failed',
  tripId: msg.tripId,
  tripName: trip?.name,
  parkName: m?.parkName,
  siteName: m?.siteName,
  checkIn: m?.checkIn,
  checkOut: m?.checkOut,
  bookingDate: new Date().toISOString(),
  status: 'failed',
  error: msg.error ?? 'Unknown error',
})
```

For notification error:

```ts
void logEntry({
  level: 'error',
  event: 'notification_error',
  message: 'Notification failed',
  error: chrome.runtime.lastError.message,
})
```

- [ ] **Step 5: Fix remaining TypeScript call sites**

Run:

```bash
cd extension && npm run build
```

Expected before fixes: TypeScript lists any remaining `addDebugLog(string)` calls. Replace each remaining call with a structured `logEntry({ level, event, message, ... })` object. Use `debug` for verbose scan details, `info` for normal scan and milestone events, `warning` for retry/skipped/suppressed states, and `error` for failures.

- [ ] **Step 6: Run background tests to verify pass**

Run:

```bash
cd extension && npm test -- tests/background/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/background/index.ts extension/tests/background/index.test.ts
git commit -m "feat(extension): emit structured scanner log events"
```

## Task 5: Full Verification

**Files:**
- No source edits expected unless verification finds a defect.

- [ ] **Step 1: Run focused tests**

```bash
cd extension && npm test -- tests/storage.test.ts tests/debugLog.test.ts tests/options-auth.test.ts tests/background/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full extension test suite**

```bash
cd extension && npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```bash
cd extension && npm run build
```

Expected: PASS with Vite producing `extension/dist`.

- [ ] **Step 4: Inspect git status**

```bash
git status --short
```

Expected: only intentional changes from this plan plus any pre-existing unrelated user changes. Do not revert unrelated modified files.

- [ ] **Step 5: Commit verification fixes if any**

If Step 1, 2, or 3 required fixes:

```bash
git add extension/src extension/tests extension/options
git commit -m "fix(extension): stabilize structured log viewer"
```

If no fixes were required, do not create an empty commit.
