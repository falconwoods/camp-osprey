# CampSniper Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension (MV3) that scans BC Parks for campsite cancellations and automatically notifies, holds, or pays for a site when found — using the user's existing Chrome session.

**Architecture:** A service worker polls BC Parks via `chrome.alarms`, sharing Chrome's cookie jar so no credentials need to be stored. Users configure independent "Trips" (each with its own parks, dates, filters, and action mode) stored in `chrome.storage.local`. The popup shows trip status; the options page handles all config. A content script drives checkout for Auto-pay mode.

**Tech Stack:** TypeScript, Vite (multi-entry), Vitest + vitest-chrome (unit tests), Playwright (E2E)

---

## File Map

```
campsite-booking/extension/
├── manifest.json                   # MV3 manifest
├── package.json
├── vite.config.ts                  # multi-entry build
├── vitest.config.ts
├── tsconfig.json
├── icons/
│   ├── icon48.png                  # placeholder icons
│   └── icon128.png
├── src/
│   ├── types.ts                    # all shared interfaces
│   ├── storage.ts                  # typed chrome.storage.local wrappers
│   ├── dates.ts                    # DateRange → {checkIn,checkOut}[] expansion
│   ├── providers/
│   │   └── bcparks.ts              # BC Parks API client (searchParks, getAvailability, holdSite)
│   ├── background/
│   │   ├── index.ts                # service worker entry — wires alarms + scanner
│   │   ├── login.ts                # isLoggedIn cookie check + onChanged listener
│   │   └── scanner.ts              # per-trip scan cycle, on-match dispatch
│   ├── popup/
│   │   ├── index.html
│   │   └── index.ts                # renders trip list, start/stop, login warning
│   ├── options/
│   │   ├── index.html
│   │   └── index.ts                # trip editor, park search, date picker, payment form
│   └── content/
│       └── bcparks.ts              # injected on camping.bcparks.ca — drives auto-pay checkout
├── tests/
│   ├── dates.test.ts
│   ├── storage.test.ts
│   ├── providers/
│   │   └── bcparks.test.ts
│   └── background/
│       ├── login.test.ts
│       └── scanner.test.ts
└── e2e/
    └── extension.test.ts           # load built extension in Chromium, smoke test popup
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `extension/package.json`
- Create: `extension/vite.config.ts`
- Create: `extension/vitest.config.ts`
- Create: `extension/tsconfig.json`
- Create: `extension/manifest.json`

- [ ] **Step 1: Create the extension directory and package.json**

```bash
mkdir -p campsite-booking/extension/src/providers campsite-booking/extension/src/background campsite-booking/extension/src/popup campsite-booking/extension/src/options campsite-booking/extension/src/content campsite-booking/extension/tests/providers campsite-booking/extension/tests/background campsite-booking/extension/icons campsite-booking/extension/e2e
```

Create `extension/package.json`:
```json
{
  "name": "campsniper-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@playwright/test": "^1.44.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0",
    "vitest-chrome": "^0.2.0",
    "jsdom": "^24.0.0",
    "@vitest/coverage-v8": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
// extension/vite.config.ts
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/bcparks.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
})
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
// extension/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['vitest-chrome/setup'],
  },
})
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "lib": ["ES2022", "DOM"],
    "types": ["chrome"],
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 5: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "CampSniper",
  "version": "0.1.0",
  "description": "Scan BC Parks for campsite cancellations and auto-reserve when found.",
  "permissions": ["alarms", "cookies", "notifications", "storage", "tabs"],
  "host_permissions": ["https://camping.bcparks.ca/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": { "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "options_page": "options/index.html",
  "content_scripts": [
    {
      "matches": ["https://camping.bcparks.ca/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": { "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

- [ ] **Step 6: Add placeholder icons and copy manifest in vite build**

Add to `vite.config.ts` (replace previous content):
```typescript
import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/bcparks.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  plugins: [{
    name: 'copy-manifest',
    closeBundle() {
      copyFileSync('manifest.json', 'dist/manifest.json')
      mkdirSync('dist/icons', { recursive: true })
      // Copy icons if they exist
      try { copyFileSync('icons/icon48.png', 'dist/icons/icon48.png') } catch {}
      try { copyFileSync('icons/icon128.png', 'dist/icons/icon128.png') } catch {}
    },
  }],
})
```

Create a 48×48 green tent icon placeholder (any 48px PNG — use any tool or copy from a free icon source). Name it `extension/icons/icon48.png` and `extension/icons/icon128.png`.

- [ ] **Step 7: Install dependencies**

```bash
cd campsite-booking/extension && npm install
```

Expected: node_modules created, no errors.

- [ ] **Step 8: Verify build runs**

```bash
cd campsite-booking/extension && npm run build
```

Expected: `dist/` directory created with `background.js`, `content.js`, `manifest.json`, `popup/index.html`, `options/index.html`.

- [ ] **Step 9: Commit**

```bash
cd campsite-booking && git add extension/ && git commit -m "feat(extension): scaffold Chrome extension project"
```

---

## Task 2: Types and Storage Layer

**Files:**
- Create: `extension/src/types.ts`
- Create: `extension/src/storage.ts`
- Create: `extension/tests/storage.test.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// extension/src/types.ts

export interface Trip {
  id: string
  name: string
  parks: Park[]           // index 0 = highest priority
  dateRanges: DateRange[]
  filters: Filters
  mode: 'notify' | 'hold' | 'autopay'
  status: 'idle' | 'scanning' | 'paused' | 'completed'
  lastMatch: MatchedSite | null
  attempted: string[]     // "parkId|checkIn|checkOut" dedup keys
  createdAt: number
}

export interface Park {
  id: string              // BC Parks resourceLocationId as string
  name: string
}

export interface Filters {
  noWalkin: boolean
  noDouble: boolean
}

export type DateRange =
  | { type: 'specific'; checkIn: string; checkOut: string }
  | { type: 'recurring'; year: number; month: number; startDay: number; endDay: number }
  // startDay/endDay: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun

export interface MatchedSite {
  parkName: string
  siteName: string
  sectionName: string
  checkIn: string         // ISO date YYYY-MM-DD
  checkOut: string        // ISO date YYYY-MM-DD
  bookingUrl: string
  resourceId: string
}

export interface AvailableSite {
  resourceId: string
  campgroundId: string
  campgroundName: string
  sectionName: string
  siteName: string
  mapId: string
  isWalkin: boolean
  isDouble: boolean
  checkIn: string         // ISO date YYYY-MM-DD
  checkOut: string        // ISO date YYYY-MM-DD
}

export interface PaymentConfig {
  cardNumber: string
  cardHolder: string
  cardExpiry: string      // "MM/YY"
  cardCvv: string
  partySize: number
}

export interface Settings {
  pollIntervalSeconds: 30 | 60 | 120
}

export interface StorageData {
  trips: Trip[]
  payment: PaymentConfig | null
  settings: Settings
}
```

- [ ] **Step 2: Write failing storage tests**

```typescript
// extension/tests/storage.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getStorage, saveTrips, updateTrip, savePayment, saveSettings } from '../src/storage'
import type { Trip } from '../src/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Test Trip',
    parks: [],
    dateRanges: [],
    filters: { noWalkin: false, noDouble: false },
    mode: 'notify',
    status: 'idle',
    lastMatch: null,
    attempted: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('getStorage', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({}))
  })

  it('returns defaults when storage is empty', async () => {
    const data = await getStorage()
    expect(data.trips).toEqual([])
    expect(data.payment).toBeNull()
    expect(data.settings.pollIntervalSeconds).toBe(60)
  })
})

describe('saveTrips', () => {
  it('calls chrome.storage.local.set with trips', async () => {
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())
    const trips = [makeTrip()]
    await saveTrips(trips)
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ trips }, expect.any(Function))
  })
})

describe('updateTrip', () => {
  it('merges updates into matching trip', async () => {
    const trip = makeTrip()
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ trips: [trip] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await updateTrip('trip-1', { status: 'scanning' })

    const setCall = (chrome.storage.local.set as any).mock.calls[0][0]
    expect(setCall.trips[0].status).toBe('scanning')
    expect(setCall.trips[0].name).toBe('Test Trip')
  })

  it('throws if trip not found', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ trips: [] }))
    await expect(updateTrip('missing', {})).rejects.toThrow('not found')
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd campsite-booking/extension && npm test -- tests/storage.test.ts
```

Expected: FAIL — `Cannot find module '../src/storage'`

- [ ] **Step 4: Implement storage.ts**

```typescript
// extension/src/storage.ts
import type { StorageData, Trip, PaymentConfig, Settings } from './types'

const DEFAULTS: StorageData = {
  trips: [],
  payment: null,
  settings: { pollIntervalSeconds: 60 },
}

function promisify<T>(fn: (callback: (result: T) => void) => void): Promise<T> {
  return new Promise(resolve => fn(resolve))
}

export async function getStorage(): Promise<StorageData> {
  const keys = Object.keys(DEFAULTS)
  const result = await promisify<Record<string, unknown>>(cb =>
    chrome.storage.local.get(keys, cb)
  )
  return { ...DEFAULTS, ...result } as StorageData
}

export async function saveTrips(trips: Trip[]): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ trips }, cb))
}

export async function savePayment(payment: PaymentConfig | null): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ payment }, cb))
}

export async function saveSettings(settings: Settings): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ settings }, cb))
}

export async function updateTrip(tripId: string, updates: Partial<Trip>): Promise<void> {
  const { trips } = await getStorage()
  const idx = trips.findIndex(t => t.id === tripId)
  if (idx === -1) throw new Error(`Trip ${tripId} not found`)
  trips[idx] = { ...trips[idx], ...updates }
  await saveTrips(trips)
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd campsite-booking/extension && npm test -- tests/storage.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd campsite-booking && git add extension/src/types.ts extension/src/storage.ts extension/tests/storage.test.ts && git commit -m "feat(extension): add types and storage layer"
```

---

## Task 3: Date Range Expansion

**Files:**
- Create: `extension/src/dates.ts`
- Create: `extension/tests/dates.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// extension/tests/dates.test.ts
import { describe, it, expect } from 'vitest'
import { expandDateRange, DAY } from '../src/dates'

describe('expandDateRange — specific', () => {
  it('returns single window for specific dates', () => {
    const result = expandDateRange({ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-06' })
    expect(result).toEqual([{ checkIn: '2026-07-04', checkOut: '2026-07-06' }])
  })
})

describe('expandDateRange — recurring', () => {
  it('returns all Fri–Sun weekends in July 2026', () => {
    const result = expandDateRange({ type: 'recurring', year: 2026, month: 7, startDay: DAY.FRI, endDay: DAY.SUN })
    // July 2026: Fri Jul 3, 10, 17, 24, 31
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ checkIn: '2026-07-03', checkOut: '2026-07-05' })
    expect(result[1]).toEqual({ checkIn: '2026-07-10', checkOut: '2026-07-12' })
    expect(result[4]).toEqual({ checkIn: '2026-07-31', checkOut: '2026-08-02' })
  })

  it('returns single-night Sat stays for all Saturdays in August 2026', () => {
    const result = expandDateRange({ type: 'recurring', year: 2026, month: 8, startDay: DAY.SAT, endDay: DAY.SAT })
    // Aug 2026: Sat Aug 1, 8, 15, 22, 29
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ checkIn: '2026-08-01', checkOut: '2026-08-08' })
  })

  it('handles month with no matching weekday', () => {
    // Feb 2026 starts on Sunday. First Monday is Feb 2.
    const result = expandDateRange({ type: 'recurring', year: 2026, month: 2, startDay: DAY.MON, endDay: DAY.MON })
    expect(result.every(r => r.checkIn.startsWith('2026-02'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd campsite-booking/extension && npm test -- tests/dates.test.ts
```

Expected: FAIL — `Cannot find module '../src/dates'`

- [ ] **Step 3: Implement dates.ts**

```typescript
// extension/src/dates.ts
import type { DateRange } from './types'

// Day constants — 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
export const DAY = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 } as const

export interface DateWindow {
  checkIn: string   // YYYY-MM-DD
  checkOut: string  // YYYY-MM-DD
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Convert our Mon=0 convention to JS getDay() Sun=0 convention
function toJSDay(ourDay: number): number {
  return (ourDay + 1) % 7
}

export function expandDateRange(range: DateRange): DateWindow[] {
  if (range.type === 'specific') {
    return [{ checkIn: range.checkIn, checkOut: range.checkOut }]
  }

  const { year, month, startDay, endDay } = range
  const results: DateWindow[] = []
  const firstOfMonth = new Date(year, month - 1, 1)
  const jsTarget = toJSDay(startDay)
  const daysAhead = (jsTarget - firstOfMonth.getDay() + 7) % 7
  const nights = ((endDay - startDay) + 7) % 7 || 7

  let current = new Date(year, month - 1, 1 + daysAhead)
  while (current.getMonth() === month - 1) {
    const checkOut = new Date(current)
    checkOut.setDate(checkOut.getDate() + nights)
    results.push({ checkIn: toISO(current), checkOut: toISO(checkOut) })
    current.setDate(current.getDate() + 7)
  }
  return results
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd campsite-booking/extension && npm test -- tests/dates.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd campsite-booking && git add extension/src/dates.ts extension/tests/dates.test.ts && git commit -m "feat(extension): add date range expansion"
```

---

## Task 4: BC Parks Provider — Park Search and Availability

**Files:**
- Create: `extension/src/providers/bcparks.ts`
- Create: `extension/tests/providers/bcparks.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// extension/tests/providers/bcparks.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BCParksProvider } from '../../src/providers/bcparks'

const BASE = 'https://camping.bcparks.ca'

function mockFetch(responses: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = Object.keys(responses).find(k => url.includes(k))
    if (!key) throw new Error(`Unexpected fetch: ${url}`)
    return { ok: true, json: async () => responses[key] }
  }))
}

describe('searchParks', () => {
  it('returns matching parks filtered by query', async () => {
    mockFetch({
      '/api/resourceLocation': [
        { resourceLocationId: 1, localizedValues: [{ shortName: 'Garibaldi', fullName: 'Garibaldi Lake' }] },
        { resourceLocationId: 2, localizedValues: [{ shortName: 'Alice Lake', fullName: 'Alice Lake Park' }] },
      ],
    })
    const provider = new BCParksProvider()
    const results = await provider.searchParks('garib')
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ id: '1', name: 'Garibaldi' })
  })

  it('returns all parks for empty query', async () => {
    mockFetch({
      '/api/resourceLocation': [
        { resourceLocationId: 1, localizedValues: [{ shortName: 'Garibaldi', fullName: 'Garibaldi Lake' }] },
      ],
    })
    const provider = new BCParksProvider()
    const results = await provider.searchParks('')
    expect(results).toHaveLength(1)
  })
})

describe('getAvailability', () => {
  beforeEach(() => {
    mockFetch({
      '/api/cart': {
        cartUid: 'cart-123',
        newTransaction: { cartTransactionUid: 'tx-456', terminalLocationId: -2147483590 },
      },
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1' }], linkedResources: [] },
        'res-2': { localizedValues: [{ name: 'Site A2' }], linkedResources: [] },
      },
      '/api/maps': [
        {
          mapId: 100,
          localizedValues: [{ title: 'Main Loop' }],
          mapResources: [
            { resourceId: 'res-1' },
            { resourceId: 'res-2' },
          ],
        },
      ],
      '/api/availability/resourcedailyavailability': [
        { availability: 0 },  // free
      ],
    })
  })

  it('returns available sites', async () => {
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-06', { noWalkin: false, noDouble: false })
    expect(sites.length).toBeGreaterThan(0)
    expect(sites[0].campgroundId).toBe('42')
    expect(sites[0].checkIn).toBe('2026-07-04')
  })

  it('excludes walk-in sites when noWalkin is true', async () => {
    mockFetch({
      '/api/cart': { cartUid: 'c', newTransaction: { cartTransactionUid: 't', terminalLocationId: -1 } },
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Walk-in Site', description: 'first-come first-served' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Walk-in Area' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/resourcedailyavailability': [{ availability: 0 }],
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: true, noDouble: false })
    expect(sites).toHaveLength(0)
  })

  it('returns empty when all nights unavailable', async () => {
    mockFetch({
      '/api/cart': { cartUid: 'c', newTransaction: { cartTransactionUid: 't', terminalLocationId: -1 } },
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/resourcedailyavailability': [{ availability: 1 }],  // occupied
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false })
    expect(sites).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd campsite-booking/extension && npm test -- tests/providers/bcparks.test.ts
```

Expected: FAIL — `Cannot find module '../../src/providers/bcparks'`

- [ ] **Step 3: Implement bcparks.ts**

```typescript
// extension/src/providers/bcparks.ts
import type { AvailableSite, Filters, Park } from '../types'

const BASE = 'https://camping.bcparks.ca'
const CONCURRENCY = 10

interface CartState {
  cartUid: string
  cartTxUid: string
  terminalLocationId: number
  cartData: Record<string, unknown>
}

// Cache survives service worker suspension via session storage
async function getCached<T>(key: string): Promise<T | null> {
  const result = await new Promise<Record<string, unknown>>(resolve =>
    chrome.storage.session.get(key, resolve)
  )
  return (result[key] as T) ?? null
}

async function setCached(key: string, value: unknown): Promise<void> {
  await new Promise<void>(resolve => chrome.storage.session.set({ [key]: value }, resolve))
}

export class BCParksProvider {
  private cartState: CartState | null = null

  private async api(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(BASE + path)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const resp = await fetch(url.toString(), { credentials: 'include' })
    if (!resp.ok) throw new Error(`BC Parks API error ${resp.status}: ${path}`)
    return resp.json()
  }

  private async ensureCart(): Promise<CartState> {
    if (this.cartState) return this.cartState
    const data = await this.api('/api/cart') as Record<string, unknown>
    const tx = data['newTransaction'] as Record<string, unknown>
    this.cartState = {
      cartUid: data['cartUid'] as string,
      cartTxUid: tx['cartTransactionUid'] as string,
      terminalLocationId: (tx['terminalLocationId'] as number) ?? -2147483590,
      cartData: data,
    }
    return this.cartState
  }

  async searchParks(query: string): Promise<Park[]> {
    const locations = await this.api('/api/resourceLocation') as Array<Record<string, unknown>>
    const term = query.toLowerCase()
    return locations
      .filter(loc => {
        if (!term) return true
        const vals = (loc['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
        return (vals['shortName'] ?? '').toLowerCase().includes(term)
          || (vals['fullName'] ?? '').toLowerCase().includes(term)
      })
      .map(loc => {
        const vals = (loc['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
        return { id: String(loc['resourceLocationId']), name: vals['shortName'] ?? String(loc['resourceLocationId']) }
      })
  }

  private async getResources(campgroundId: string): Promise<Record<string, Record<string, unknown>>> {
    const cacheKey = `resources_${campgroundId}`
    const cached = await getCached<Record<string, Record<string, unknown>>>(cacheKey)
    if (cached) return cached
    const data = await this.api('/api/resourcelocation/resources', { resourceLocationId: campgroundId })
    await setCached(cacheKey, data)
    return data as Record<string, Record<string, unknown>>
  }

  private async getSections(campgroundId: string): Promise<Record<string, [string, boolean, string]>> {
    const cacheKey = `sections_${campgroundId}`
    const cached = await getCached<Record<string, [string, boolean, string]>>(cacheKey)
    if (cached) return cached
    const maps = await this.api('/api/maps', { resourceLocationId: campgroundId }) as Array<Record<string, unknown>>
    const sections: Record<string, [string, boolean, string]> = {}
    for (const m of maps) {
      const mapId = String(m['mapId'])
      const vals = (m['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
      const title = vals['title'] ?? ''
      const isWalkin = title.toLowerCase().includes('walk')
      for (const mr of (m['mapResources'] as Array<Record<string, unknown>>) ?? []) {
        sections[String(mr['resourceId'])] = [title, isWalkin, mapId]
      }
    }
    await setCached(cacheKey, sections)
    return sections
  }

  private siteFlags(resource: Record<string, unknown>, sectionIsWalkin: boolean): [boolean, boolean] {
    const vals = (resource['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
    const desc = (vals['description'] ?? '').toLowerCase()
    const isWalkin = sectionIsWalkin || desc.includes('first-come') || desc.includes('first come')
    const isDouble = desc.includes('double site') || ((resource['linkedResources'] as unknown[])?.length ?? 0) > 0
    return [isWalkin, isDouble]
  }

  async getAvailability(
    campgroundId: string,
    checkIn: string,
    checkOut: string,
    filters: Filters,
  ): Promise<AvailableSite[]> {
    await this.ensureCart()
    const [resources, sections] = await Promise.all([
      this.getResources(campgroundId),
      this.getSections(campgroundId),
    ])

    const numNights = Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000
    )

    const candidates = Object.entries(resources)
      .map(([resourceId, resource]) => {
        const [sectionName, sectionIsWalkin, mapId] = sections[resourceId] ?? ['', false, '']
        const [isWalkin, isDouble] = this.siteFlags(resource, sectionIsWalkin)
        if (filters.noWalkin && isWalkin) return null
        if (filters.noDouble && isDouble) return null
        const vals = (resource['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
        return { resourceId, sectionName, isWalkin, isDouble, siteName: vals['name'] ?? resourceId, mapId }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)

    const semaphore = { count: 0, queue: [] as Array<() => void> }
    const acquire = () => new Promise<void>(resolve => {
      if (semaphore.count < CONCURRENCY) { semaphore.count++; resolve() }
      else semaphore.queue.push(resolve)
    })
    const release = () => {
      semaphore.count--
      const next = semaphore.queue.shift()
      if (next) { semaphore.count++; next() }
    }

    const results = await Promise.all(candidates.map(async c => {
      await acquire()
      try {
        const daily = await this.api('/api/availability/resourcedailyavailability', {
          cartUid: this.cartState!.cartUid,
          resourceId: c.resourceId,
          bookingCategoryId: '0',
          startDate: checkIn,
          endDate: checkOut,
          isReserving: 'true',
          equipmentCategoryId: '-32768',
          subEquipmentCategoryId: '-32768',
          boatLength: '0', boatDraft: '0', boatWidth: '0',
          peopleCapacityCategoryCounts: '[]',
          numEquipment: '0',
          filterData: '[]',
          groupHoldUid: '',
          bookingUid: crypto.randomUUID(),
        }) as Array<Record<string, number>>

        const available = daily.slice(0, numNights).every(d => d['availability'] === 0)
        if (!available) return null

        return {
          resourceId: c.resourceId,
          campgroundId,
          campgroundName: '',
          sectionName: c.sectionName,
          siteName: c.siteName,
          mapId: c.mapId,
          isWalkin: c.isWalkin,
          isDouble: c.isDouble,
          checkIn,
          checkOut,
        } satisfies AvailableSite
      } catch {
        return null
      } finally {
        release()
      }
    }))

    return results.filter((r): r is AvailableSite => r !== null)
  }

  async holdSite(site: AvailableSite, partySize: number): Promise<void> {
    const cart = await this.ensureCart()
    const bookingUid = crypto.randomUUID()
    const blockerUid = crypto.randomUUID()
    const now = new Date().toISOString()

    const cartBody = {
      ...cart.cartData,
      bookings: [{
        bookingUid,
        cartUid: cart.cartUid,
        bookingCategoryId: 0,
        bookingModel: 0,
        createTransactionUid: cart.cartTxUid,
        currentVersion: null,
        history: [],
        drafts: [],
        referenceNumberPostfix: '',
        newVersion: {
          cartTransactionUid: cart.cartTxUid,
          bookingMembers: [], bookingVehicles: [], bookingBoats: [],
          bookingCapacityCategoryCounts: [
            { capacityCategoryId: -32767, subCapacityCategoryId: -32768, count: partySize, isAdult: true },
            { capacityCategoryId: -32767, subCapacityCategoryId: -32767, count: 0, isAdult: true },
            { capacityCategoryId: -32767, subCapacityCategoryId: -32766, count: 0, isAdult: false },
            { capacityCategoryId: -32767, subCapacityCategoryId: -32765, count: 0, isAdult: false },
          ],
          rateCategoryId: -32768,
          resourceBlockerUids: [blockerUid],
          resourceNonSpecificBlockerUids: [], resourceZoneBlockerUids: [], resourceZoneEntryBlockerUids: [],
          startDate: site.checkIn,
          endDate: site.checkOut,
          releasePersonalInformation: false,
          equipmentCategoryId: -32768, subEquipmentCategoryId: -32768,
          occupant: { contact: { email: '', contactName: '', phoneNumberCountryCode: null, phoneNumber: '' }, address: {}, allowMarketing: false, phoneNumbers: {}, preferredCultureName: 'en-CA', firstName: '', lastName: '' },
          requiresCheckout: false, bookingStatus: 0, completedDate: now, arrivalComment: '',
          entryPointResourceId: null, exitPointResourceId: null, bookingSurcharges: [],
          consentToRelease: false, equipmentDescription: '', groupHoldUid: '', organizationName: '',
          passExpiryDate: null, passNumber: '',
          resourceLocationId: parseInt(site.campgroundId),
          checkInTime: null, checkOutTime: null, deferredPayment: false,
        },
      }],
      resourceBlockers: [{
        blockerType: 0, cartUid: cart.cartUid,
        resourceBlockerUid: blockerUid, bookingUid, groupHoldUid: '', isReservation: true,
        newVersion: {
          creationDate: now, cartTransactionUid: cart.cartTxUid,
          startDate: site.checkIn, endDate: site.checkOut,
          resourceId: parseInt(site.resourceId),
          resourceLocationId: parseInt(site.campgroundId), status: 0,
        },
      }],
    }

    // Step 1: hold
    const resp1 = await fetch(`${BASE}/api/cart/commit?isCompleted=false&isSelfCheckIn=false`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart: cartBody }),
    })
    if (!resp1.ok) {
      const detail = await resp1.json().catch(() => ({}))
      throw new Error((detail as Record<string, string>)['messageKey'] ?? `Cart commit failed: ${resp1.status}`)
    }

    // Step 2: fetch updated cart and confirm
    const cartResp = await fetch(`${BASE}/api/cart`, { credentials: 'include' })
    const confirmedCart = await cartResp.json()
    const resp2 = await fetch(`${BASE}/api/cart/commit?isCompleted=false&isSelfCheckIn=false`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart: confirmedCart }),
    })
    if (!resp2.ok) {
      const detail = await resp2.json().catch(() => ({}))
      throw new Error((detail as Record<string, string>)['messageKey'] ?? `Confirmation failed: ${resp2.status}`)
    }

    this.cartState = null  // reset so next trip gets a fresh cart
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd campsite-booking/extension && npm test -- tests/providers/bcparks.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd campsite-booking && git add extension/src/providers/bcparks.ts extension/tests/providers/bcparks.test.ts && git commit -m "feat(extension): add BCParksProvider with search, availability, and hold"
```

---

## Task 5: Login State Detection

**Files:**
- Create: `extension/src/background/login.ts`
- Create: `extension/tests/background/login.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// extension/tests/background/login.test.ts
import { describe, it, expect } from 'vitest'
import { isLoggedIn } from '../../src/background/login'

describe('isLoggedIn', () => {
  it('returns true when isLoggedIn cookie is present with value "true"', async () => {
    chrome.cookies.get.mockImplementation((_details, cb) =>
      cb({ name: 'isLoggedIn', value: 'true' } as chrome.cookies.Cookie)
    )
    expect(await isLoggedIn()).toBe(true)
  })

  it('returns false when cookie is absent', async () => {
    chrome.cookies.get.mockImplementation((_details, cb) => cb(null))
    expect(await isLoggedIn()).toBe(false)
  })

  it('returns false when cookie value is not "true"', async () => {
    chrome.cookies.get.mockImplementation((_details, cb) =>
      cb({ name: 'isLoggedIn', value: 'false' } as chrome.cookies.Cookie)
    )
    expect(await isLoggedIn()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd campsite-booking/extension && npm test -- tests/background/login.test.ts
```

Expected: FAIL — `Cannot find module '../../src/background/login'`

- [ ] **Step 3: Implement login.ts**

```typescript
// extension/src/background/login.ts

export async function isLoggedIn(): Promise<boolean> {
  return new Promise(resolve =>
    chrome.cookies.get(
      { url: 'https://camping.bcparks.ca', name: 'isLoggedIn' },
      cookie => resolve(cookie?.value === 'true')
    )
  )
}

export function watchLoginChanges(onChange: (loggedIn: boolean) => void): void {
  chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
    if (cookie.domain.includes('camping.bcparks.ca') && cookie.name === 'isLoggedIn') {
      onChange(!removed && cookie.value === 'true')
    }
  })
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd campsite-booking/extension && npm test -- tests/background/login.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd campsite-booking && git add extension/src/background/login.ts extension/tests/background/login.test.ts && git commit -m "feat(extension): add login state detection"
```

---

## Task 6: Scanner — Trip Scan Loop

**Files:**
- Create: `extension/src/background/scanner.ts`
- Create: `extension/tests/background/scanner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// extension/tests/background/scanner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scanTrip } from '../../src/background/scanner'
import type { Trip, AvailableSite } from '../../src/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1', name: 'Test', parks: [{ id: 'p1', name: 'Park 1' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-06' }],
    filters: { noWalkin: false, noDouble: false },
    mode: 'notify', status: 'scanning', lastMatch: null,
    attempted: [], createdAt: Date.now(),
    ...overrides,
  }
}

function makeSite(overrides: Partial<AvailableSite> = {}): AvailableSite {
  return {
    resourceId: 'res-1', campgroundId: 'p1', campgroundName: 'Park 1',
    sectionName: 'Main', siteName: 'A1', mapId: '100',
    isWalkin: false, isDouble: false,
    checkIn: '2026-07-04', checkOut: '2026-07-06',
    ...overrides,
  }
}

describe('scanTrip', () => {
  const mockGetAvailability = vi.fn()

  beforeEach(() => {
    mockGetAvailability.mockReset()
  })

  it('returns null when no sites available', async () => {
    mockGetAvailability.mockResolvedValue([])
    const result = await scanTrip(makeTrip(), mockGetAvailability)
    expect(result).toBeNull()
  })

  it('returns first match when site is available', async () => {
    const site = makeSite()
    mockGetAvailability.mockResolvedValue([site])
    const result = await scanTrip(makeTrip(), mockGetAvailability)
    expect(result).toEqual(site)
  })

  it('skips already-attempted park/date combinations', async () => {
    const site = makeSite()
    mockGetAvailability.mockResolvedValue([site])
    const trip = makeTrip({ attempted: ['p1|2026-07-04|2026-07-06'] })
    const result = await scanTrip(trip, mockGetAvailability)
    expect(result).toBeNull()
    expect(mockGetAvailability).not.toHaveBeenCalled()
  })

  it('checks parks in priority order', async () => {
    const calls: string[] = []
    mockGetAvailability.mockImplementation(async (id: string) => {
      calls.push(id)
      return []
    })
    const trip = makeTrip({
      parks: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    })
    await scanTrip(trip, mockGetAvailability)
    expect(calls).toEqual(['p1', 'p2'])
  })

  it('returns first match and stops checking further parks', async () => {
    const site = makeSite()
    let callCount = 0
    mockGetAvailability.mockImplementation(async () => {
      callCount++
      return callCount === 1 ? [site] : []
    })
    const trip = makeTrip({ parks: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] })
    await scanTrip(trip, mockGetAvailability)
    expect(callCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd campsite-booking/extension && npm test -- tests/background/scanner.test.ts
```

Expected: FAIL — `Cannot find module '../../src/background/scanner'`

- [ ] **Step 3: Implement scanner.ts**

```typescript
// extension/src/background/scanner.ts
import type { Trip, AvailableSite, Filters } from '../types'
import { expandDateRange } from '../dates'
import { updateTrip } from '../storage'

type GetAvailabilityFn = (
  campgroundId: string,
  checkIn: string,
  checkOut: string,
  filters: Filters,
) => Promise<AvailableSite[]>

export async function scanTrip(
  trip: Trip,
  getAvailability: GetAvailabilityFn,
): Promise<AvailableSite | null> {
  for (const park of trip.parks) {
    for (const dateRange of trip.dateRanges) {
      for (const window of expandDateRange(dateRange)) {
        const key = `${park.id}|${window.checkIn}|${window.checkOut}`
        if (trip.attempted.includes(key)) continue

        const sites = await getAvailability(park.id, window.checkIn, window.checkOut, trip.filters)
        if (sites.length > 0) return { ...sites[0], campgroundName: park.name }
      }
    }
  }
  return null
}

export function makeAttemptedKey(site: AvailableSite): string {
  return `${site.campgroundId}|${site.checkIn}|${site.checkOut}`
}

export function buildBookingUrl(site: AvailableSite): string {
  const nights = Math.round(
    (new Date(site.checkOut).getTime() - new Date(site.checkIn).getTime()) / 86_400_000
  )
  const pid = site.campgroundId
  const mid = site.mapId || pid
  return (
    `https://camping.bcparks.ca/create-booking/results` +
    `?transactionLocationId=${pid}&resourceLocationId=${pid}&mapId=${mid}` +
    `&searchTabGroupId=0&bookingCategoryId=0` +
    `&startDate=${site.checkIn}&endDate=${site.checkOut}&nights=${nights}` +
    `&isReserving=true&equipmentId=-32768&subEquipmentId=-32768`
  )
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd campsite-booking/extension && npm test -- tests/background/scanner.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Run all tests**

```bash
cd campsite-booking/extension && npm test
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd campsite-booking && git add extension/src/background/scanner.ts extension/tests/background/scanner.test.ts && git commit -m "feat(extension): add trip scanner with deduplication and priority order"
```

---

## Task 7: Service Worker Entry Point

**Files:**
- Create: `extension/src/background/index.ts`

- [ ] **Step 1: Implement the service worker**

```typescript
// extension/src/background/index.ts
import { BCParksProvider } from '../providers/bcparks'
import { getStorage, updateTrip } from '../storage'
import { isLoggedIn, watchLoginChanges } from './login'
import { scanTrip, makeAttemptedKey, buildBookingUrl } from './scanner'
import type { AvailableSite, Trip } from '../types'

const ALARM_NAME = 'scan'
const provider = new BCParksProvider()

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm(60)
})

async function setupAlarm(intervalSeconds: number): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME)
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalSeconds / 60 })
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return
  await runScanCycle()
})

// Restore alarm on service worker restart
chrome.storage.local.get('settings', result => {
  const interval = result['settings']?.pollIntervalSeconds ?? 60
  setupAlarm(interval)
})

// Auto-restore Hold/Autopay mode when user logs back in
watchLoginChanges(async loggedIn => {
  if (!loggedIn) return
  const { trips } = await getStorage()
  for (const trip of trips) {
    if (trip.status === 'scanning') {
      await updateTrip(trip.id, { status: 'scanning' })  // force popup refresh
    }
  }
})

async function runScanCycle(): Promise<void> {
  const { trips, payment, settings } = await getStorage()
  await setupAlarm(settings.pollIntervalSeconds)

  const scanningTrips = trips.filter(t => t.status === 'scanning')
  for (const trip of scanningTrips) {
    const loggedIn = await isLoggedIn()
    const needsLogin = trip.mode !== 'notify' && !loggedIn
    if (needsLogin) {
      await notify(`CampSniper — Login Required`, `Log in to BC Parks to use ${trip.mode} mode for "${trip.name}"`)
      continue
    }

    try {
      const site = await scanTrip(trip, (id, ci, co, filters) =>
        provider.getAvailability(id, ci, co, filters)
      )
      if (site) await handleMatch(trip, site, payment?.partySize ?? 1)
    } catch (err) {
      console.error(`Scan error for trip ${trip.id}:`, err)
    }
  }
}

async function handleMatch(trip: Trip, site: AvailableSite, partySize: number): Promise<void> {
  const nights = Math.round(
    (new Date(site.checkOut).getTime() - new Date(site.checkIn).getTime()) / 86_400_000
  )
  const nightStr = `${nights} night${nights !== 1 ? 's' : ''}`
  const bookingUrl = buildBookingUrl(site)

  const matchedSite = {
    parkName: site.campgroundName || site.campgroundId,
    siteName: site.siteName,
    sectionName: site.sectionName,
    checkIn: site.checkIn,
    checkOut: site.checkOut,
    bookingUrl,
    resourceId: site.resourceId,
  }

  if (trip.mode === 'notify') {
    await notify(
      `Campsite Available — ${matchedSite.parkName}`,
      `${matchedSite.sectionName} › Site ${matchedSite.siteName}\n${site.checkIn} → ${site.checkOut} (${nightStr})`,
      bookingUrl,
    )
    await updateTrip(trip.id, { lastMatch: matchedSite })
    return
  }

  if (trip.mode === 'hold' || trip.mode === 'autopay') {
    try {
      await provider.holdSite(site, partySize)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('ResourceUnavailable')) {
        await updateTrip(trip.id, {
          attempted: [...trip.attempted, makeAttemptedKey(site)],
        })
        return
      }
      await notify(`Hold Failed — ${matchedSite.parkName}`, msg)
      await updateTrip(trip.id, { status: 'paused' })
      return
    }

    const checkoutUrl = 'https://camping.bcparks.ca/create-booking/reservationmessages'

    if (trip.mode === 'hold') {
      await notify(
        `Site Held — Complete Payment Now`,
        `${matchedSite.parkName} › Site ${matchedSite.siteName}\n${site.checkIn} → ${site.checkOut}\nHeld 15 min — open BC Parks to pay.`,
        checkoutUrl,
      )
      await chrome.tabs.create({ url: checkoutUrl })
      await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
      return
    }

    // autopay — open tab and let content script handle payment
    if (trip.mode === 'autopay') {
      await chrome.tabs.create({ url: checkoutUrl })
      await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
      // Content script will message back with confirmation
    }
  }
}

async function notify(title: string, message: string, url?: string): Promise<void> {
  const id = `campsniper-${Date.now()}`
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
  })
  if (url) {
    chrome.notifications.onClicked.addListener(function handler(notifId) {
      if (notifId === id) {
        chrome.tabs.create({ url })
        chrome.notifications.onClicked.removeListener(handler)
      }
    })
  }
}

// Handle confirmation message from content script (auto-pay complete)
chrome.runtime.onMessage.addListener((msg: { type: string; tripId?: string; confirmationNumber?: string }) => {
  if (msg.type === 'BOOKING_CONFIRMED' && msg.tripId) {
    updateTrip(msg.tripId, { status: 'completed' }).then(() => {
      notify('Booking Confirmed!', `Confirmation: ${msg.confirmationNumber ?? 'unknown'}`)
    })
  }
})
```

- [ ] **Step 2: Build and verify no TypeScript errors**

```bash
cd campsite-booking/extension && npm run build 2>&1 | head -30
```

Expected: Build succeeds, `dist/background.js` created.

- [ ] **Step 3: Commit**

```bash
cd campsite-booking && git add extension/src/background/index.ts && git commit -m "feat(extension): add service worker with alarm-based scan loop"
```

---

## Task 8: Popup UI

**Files:**
- Create: `extension/src/popup/index.html`
- Create: `extension/src/popup/index.ts`

- [ ] **Step 1: Create popup HTML**

```html
<!-- extension/src/popup/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 320px; min-height: 200px; background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; font-size: 12px; padding: 14px; }
    .header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .header-title { font-weight: 700; font-size: 14px; flex: 1; }
    .header-settings { color: #64748b; cursor: pointer; text-decoration: none; font-size: 11px; }
    .trip-card { background: #1e293b; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; border-left: 3px solid #334155; }
    .trip-card.scanning { border-left-color: #22c55e; }
    .trip-card.paused { border-left-color: #f59e0b; opacity: 0.8; }
    .trip-card.completed { border-left-color: #64748b; opacity: 0.6; }
    .trip-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .trip-name { font-weight: 600; font-size: 12px; }
    .badge { padding: 2px 7px; border-radius: 10px; font-size: 10px; }
    .badge-scanning { background: #22c55e22; color: #22c55e; }
    .badge-paused { background: #f59e0b22; color: #f59e0b; }
    .badge-idle { background: #1e3a5f; color: #64748b; }
    .badge-completed { background: #33415522; color: #64748b; }
    .trip-summary { color: #64748b; font-size: 10px; line-height: 1.6; }
    .match-banner { background: #22c55e15; border: 1px solid #22c55e44; border-radius: 5px; padding: 6px 8px; margin-top: 6px; font-size: 10px; color: #22c55e; }
    .btn { border: none; padding: 3px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; margin-top: 6px; }
    .btn-stop { background: #1e3a5f; color: #64748b; }
    .btn-start { background: #1e3a5f; color: #22c55e; }
    .btn-reserve { background: #22c55e; color: white; font-weight: 600; }
    .btn-resume { background: #1e3a5f; color: #3b82f6; }
    .add-trip { width: 100%; background: #1e3a5f; border: 1px dashed #3b82f6; color: #3b82f6; padding: 7px; border-radius: 6px; font-size: 11px; cursor: pointer; margin-top: 4px; }
    .login-warn { background: #f59e0b11; border: 1px solid #f59e0b33; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; font-size: 10px; color: #f59e0b; display: none; }
    .empty { text-align: center; color: #64748b; padding: 20px 0; font-size: 11px; }
    a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <span style="font-size:18px">🏕</span>
    <span class="header-title">CampSniper</span>
    <a class="header-settings" id="settings-link" href="#">Settings ›</a>
  </div>
  <div class="login-warn" id="login-warn">
    ⚠ Log in to BC Parks to enable Hold / Auto-pay
    <a href="https://camping.bcparks.ca" target="_blank" style="color:#3b82f6;margin-left:6px">Open BC Parks →</a>
  </div>
  <div id="trips-container"></div>
  <button class="add-trip" id="add-trip-btn">+ New Trip</button>
  <script type="module" src="index.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Create popup TypeScript**

```typescript
// extension/src/popup/index.ts
import { getStorage, updateTrip } from '../storage'
import { isLoggedIn } from '../background/login'
import type { Trip, MatchedSite } from '../types'

function openOptions(hash = '') {
  chrome.runtime.openOptionsPage()
  if (hash) {
    // Options page reads hash from storage
    chrome.storage.session.set({ optionsHash: hash })
  }
}

document.getElementById('settings-link')!.addEventListener('click', e => {
  e.preventDefault()
  openOptions()
})

document.getElementById('add-trip-btn')!.addEventListener('click', () => {
  openOptions('#new-trip')
})

function badgeClass(status: Trip['status']): string {
  return { scanning: 'badge-scanning', paused: 'badge-paused', idle: 'badge-idle', completed: 'badge-completed' }[status]
}

function badgeLabel(status: Trip['status']): string {
  return { scanning: '● Scanning', paused: '⏸ Paused', idle: '— Idle', completed: '✓ Done' }[status]
}

function renderMatch(match: MatchedSite): string {
  return `<div class="match-banner">
    Found: ${match.parkName} › ${match.sectionName} › Site ${match.siteName}<br>
    ${match.checkIn} → ${match.checkOut}
  </div>
  <a href="${match.bookingUrl}" target="_blank"><button class="btn btn-reserve">Reserve Now →</button></a>`
}

function renderTrip(trip: Trip): string {
  const parkNames = trip.parks.map(p => p.name).join(', ') || '—'
  const dateCount = trip.dateRanges.length
  const modeLabel = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }[trip.mode]

  const actionBtn = trip.status === 'scanning'
    ? `<button class="btn btn-stop" data-id="${trip.id}" data-action="stop">⏹ Stop</button>`
    : trip.status === 'paused'
    ? `<button class="btn btn-resume" data-id="${trip.id}" data-action="start">▶ Resume</button>`
    : trip.status === 'idle'
    ? `<button class="btn btn-start" data-id="${trip.id}" data-action="start">▶ Start</button>`
    : ''

  return `<div class="trip-card ${trip.status}" data-id="${trip.id}">
    <div class="trip-row">
      <span class="trip-name">${trip.name}</span>
      <span class="badge ${badgeClass(trip.status)}">${badgeLabel(trip.status)}</span>
    </div>
    <div class="trip-summary">
      ${parkNames} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel}
    </div>
    ${trip.lastMatch ? renderMatch(trip.lastMatch) : ''}
    ${actionBtn}
  </div>`
}

async function render() {
  const { trips } = await getStorage()
  const loggedIn = await isLoggedIn()
  const container = document.getElementById('trips-container')!
  const warn = document.getElementById('login-warn')!

  const needsLogin = trips.some(t => t.status === 'scanning' && t.mode !== 'notify')
  warn.style.display = !loggedIn && needsLogin ? 'block' : 'none'

  if (trips.length === 0) {
    container.innerHTML = '<div class="empty">No trips yet. Add one to start scanning.</div>'
  } else {
    container.innerHTML = trips.map(renderTrip).join('')
  }

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset['id']!
      const action = (btn as HTMLElement).dataset['action']!
      await updateTrip(id, { status: action === 'start' ? 'scanning' : 'paused' })
      await render()
    })
  })
}

render()
```

- [ ] **Step 3: Build and load extension in Chrome**

```bash
cd campsite-booking/extension && npm run build
```

Open `chrome://extensions/`, enable Developer Mode, click "Load unpacked", select `campsite-booking/extension/dist/`. Verify the popup opens and shows "No trips yet."

- [ ] **Step 4: Commit**

```bash
cd campsite-booking && git add extension/src/popup/ && git commit -m "feat(extension): add popup UI with trip list and status"
```

---

## Task 9: Options Page — Trip Editor and Park Search

**Files:**
- Create: `extension/src/options/index.html`
- Create: `extension/src/options/index.ts`

- [ ] **Step 1: Create options HTML**

```html
<!-- extension/src/options/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CampSniper Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; font-size: 13px; max-width: 720px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 12px; margin-bottom: 24px; }
    .section { margin-bottom: 24px; }
    .section-label { color: #94a3b8; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .input { width: 100%; background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 9px 12px; color: #e2e8f0; font-size: 13px; }
    .input:focus { outline: none; border-color: #3b82f6; }
    .row { display: flex; gap: 8px; align-items: center; }
    .chip { background: #1e293b; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .chip-remove { color: #64748b; cursor: pointer; background: none; border: none; font-size: 14px; }
    .btn-add { width: 100%; background: #1e3a5f; border: 1px dashed #3b82f6; color: #3b82f6; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 4px; }
    .btn-primary { background: #22c55e; border: none; color: white; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .btn-danger { background: #1e293b; border: 1px solid #ef444433; color: #ef4444; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .select { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 8px 10px; color: #e2e8f0; font-size: 12px; }
    .checkbox-row { display: flex; gap: 12px; }
    .checkbox-label { display: flex; align-items: center; gap: 6px; background: #1e293b; padding: 7px 12px; border-radius: 6px; cursor: pointer; }
    .search-results { background: #1e293b; border: 1px solid #334155; border-radius: 6px; max-height: 160px; overflow-y: auto; margin-top: 4px; display: none; }
    .search-result { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #0f172a; }
    .search-result:hover { background: #0f172a; }
    .trip-list-item { background: #1e293b; border-radius: 6px; padding: 10px 14px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
    .trip-list-item:hover { background: #233047; }
    .back-link { color: #64748b; cursor: pointer; font-size: 11px; margin-bottom: 16px; display: inline-block; }
    .hidden { display: none; }
    .tabs { display: flex; border-bottom: 1px solid #334155; margin-bottom: 20px; gap: 2px; }
    .tab { padding: 8px 16px; cursor: pointer; color: #64748b; border-bottom: 2px solid transparent; font-size: 12px; }
    .tab.active { color: #e2e8f0; border-bottom-color: #22c55e; }
    .date-form { background: #1e293b; border-radius: 8px; padding: 14px; margin-top: 8px; }
    .date-mode-toggle { display: flex; gap: 8px; margin-bottom: 12px; }
    .date-mode-btn { padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; border: 1px solid #334155; background: #0f172a; color: #64748b; }
    .date-mode-btn.active { background: #1e3a5f; color: #3b82f6; border-color: #3b82f6; }
    .preview { background: #0f172a; border-radius: 4px; padding: 6px 10px; font-size: 11px; color: #22c55e; margin-top: 8px; }
  </style>
</head>
<body>
  <div id="trips-view">
    <h1>🏕 CampSniper</h1>
    <p class="subtitle">Manage your camping trips</p>
    <div class="tabs">
      <div class="tab active" data-tab="trips">Trips</div>
      <div class="tab" data-tab="payment">Payment</div>
      <div class="tab" data-tab="settings">Settings</div>
    </div>
    <div id="tab-trips">
      <div id="trip-list"></div>
      <button class="btn-add" id="new-trip-btn">+ New Trip</button>
    </div>
    <div id="tab-payment" class="hidden">
      <div class="section">
        <div class="section-label">Card Details (for Auto-pay mode)</div>
        <input class="input" id="card-number" placeholder="Card number" style="margin-bottom:8px">
        <input class="input" id="card-holder" placeholder="Name on card" style="margin-bottom:8px">
        <div class="row" style="margin-bottom:8px">
          <input class="input" id="card-expiry" placeholder="MM/YY">
          <input class="input" id="card-cvv" placeholder="CVV">
        </div>
        <input class="input" id="party-size" type="number" min="1" max="8" placeholder="Party size">
      </div>
      <button class="btn-primary" id="save-payment-btn">Save Payment Info</button>
    </div>
    <div id="tab-settings" class="hidden">
      <div class="section">
        <div class="section-label">Check interval</div>
        <select class="select" id="poll-interval">
          <option value="30">Every 30 seconds</option>
          <option value="60" selected>Every 60 seconds</option>
          <option value="120">Every 2 minutes</option>
        </select>
      </div>
      <button class="btn-primary" id="save-settings-btn">Save Settings</button>
    </div>
  </div>

  <div id="trip-editor" class="hidden">
    <span class="back-link" id="back-btn">← All Trips</span>
    <div class="section">
      <div class="section-label">Trip Name</div>
      <input class="input" id="trip-name" placeholder="e.g. Summer Long Weekend">
    </div>
    <div class="section">
      <div class="section-label">Parks (drag to reorder priority)</div>
      <div id="parks-list"></div>
      <input class="input" id="park-search" placeholder="🔍 Search parks..." style="margin-top:6px">
      <div class="search-results" id="park-results"></div>
    </div>
    <div class="section">
      <div class="section-label">Date Ranges</div>
      <div id="dates-list"></div>
      <div class="date-form" id="date-form">
        <div class="date-mode-toggle">
          <button class="date-mode-btn active" data-mode="specific">Specific dates</button>
          <button class="date-mode-btn" data-mode="recurring">Recurring</button>
        </div>
        <div id="specific-inputs">
          <div class="row">
            <div style="flex:1"><div style="color:#64748b;font-size:10px;margin-bottom:4px">Check-in</div><input type="date" class="input" id="date-checkin"></div>
            <div style="flex:1"><div style="color:#64748b;font-size:10px;margin-bottom:4px">Check-out</div><input type="date" class="input" id="date-checkout"></div>
          </div>
        </div>
        <div id="recurring-inputs" class="hidden">
          <div class="row" style="align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <span style="color:#94a3b8">Every</span>
            <select class="select" id="rec-start-day"><option value="4">Friday</option><option value="5">Saturday</option><option value="6">Sunday</option><option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option><option value="3">Thursday</option></select>
            <span style="color:#94a3b8">to</span>
            <select class="select" id="rec-end-day"><option value="6">Sunday</option><option value="5">Saturday</option><option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option><option value="3">Thursday</option><option value="4">Friday</option></select>
            <span style="color:#94a3b8">in</span>
            <select class="select" id="rec-month"><option value="1">January</option><option value="2">February</option><option value="3">March</option><option value="4">April</option><option value="5">May</option><option value="6">June</option><option value="7" selected>July</option><option value="8">August</option><option value="9">September</option><option value="10">October</option><option value="11">November</option><option value="12">December</option></select>
            <select class="select" id="rec-year"><option value="2026">2026</option><option value="2027">2027</option></select>
          </div>
          <div class="preview" id="rec-preview">→ Select options above</div>
        </div>
        <button class="btn-add" id="add-date-btn" style="margin-top:10px">+ Add This Range</button>
      </div>
    </div>
    <div class="section">
      <div class="row">
        <div style="flex:1">
          <div class="section-label">On Match</div>
          <select class="select" id="trip-mode" style="width:100%">
            <option value="notify">Notify only</option>
            <option value="hold">Auto-reserve</option>
            <option value="autopay">Auto-pay</option>
          </select>
        </div>
        <div style="flex:1">
          <div class="section-label">Filters</div>
          <div class="checkbox-row">
            <label class="checkbox-label"><input type="checkbox" id="filter-walkin"> No walk-in</label>
            <label class="checkbox-label"><input type="checkbox" id="filter-double"> No double</label>
          </div>
        </div>
      </div>
    </div>
    <div class="row" style="gap:10px;margin-top:8px">
      <button class="btn-primary" id="save-trip-btn">Save &amp; Start Scanning</button>
      <button class="btn-danger" id="delete-trip-btn">Delete Trip</button>
    </div>
  </div>
  <script type="module" src="index.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Create options TypeScript**

```typescript
// extension/src/options/index.ts
import { getStorage, saveTrips, savePayment, saveSettings, updateTrip } from '../storage'
import { BCParksProvider } from '../providers/bcparks'
import { expandDateRange } from '../dates'
import type { Trip, DateRange, Park } from '../types'

const provider = new BCParksProvider()
let editingTripId: string | null = null
let tripParks: Park[] = []
let tripDates: DateRange[] = []
let dateMode: 'specific' | 'recurring' = 'specific'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    const name = (tab as HTMLElement).dataset['tab']!
    document.getElementById('tab-trips')!.classList.toggle('hidden', name !== 'trips')
    document.getElementById('tab-payment')!.classList.toggle('hidden', name !== 'payment')
    document.getElementById('tab-settings')!.classList.toggle('hidden', name !== 'settings')
  })
})

// Trip list
async function renderTripList() {
  const { trips } = await getStorage()
  const list = document.getElementById('trip-list')!
  list.innerHTML = trips.length === 0
    ? '<p style="color:#64748b;font-size:12px;padding:8px 0">No trips yet.</p>'
    : trips.map(t => `
      <div class="trip-list-item" data-id="${t.id}">
        <div>
          <div style="font-weight:600">${t.name}</div>
          <div style="color:#64748b;font-size:11px">${t.parks.map(p => p.name).join(', ') || '—'} · ${t.status}</div>
        </div>
        <span style="color:#64748b">›</span>
      </div>`).join('')

  list.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const trip = trips.find(t => t.id === (el as HTMLElement).dataset['id'])
      if (trip) openEditor(trip)
    })
  })
}

function openEditor(trip?: Trip) {
  editingTripId = trip?.id ?? null
  tripParks = trip ? [...trip.parks] : []
  tripDates = trip ? [...trip.dateRanges] : []

  ;(document.getElementById('trip-name') as HTMLInputElement).value = trip?.name ?? ''
  ;(document.getElementById('trip-mode') as HTMLSelectElement).value = trip?.mode ?? 'notify'
  ;(document.getElementById('filter-walkin') as HTMLInputElement).checked = trip?.filters.noWalkin ?? false
  ;(document.getElementById('filter-double') as HTMLInputElement).checked = trip?.filters.noDouble ?? false

  renderParksList()
  renderDatesList()
  document.getElementById('trips-view')!.classList.add('hidden')
  document.getElementById('trip-editor')!.classList.remove('hidden')
}

document.getElementById('back-btn')!.addEventListener('click', () => {
  document.getElementById('trip-editor')!.classList.add('hidden')
  document.getElementById('trips-view')!.classList.remove('hidden')
  renderTripList()
})

document.getElementById('new-trip-btn')!.addEventListener('click', () => openEditor())

// Parks
function renderParksList() {
  const list = document.getElementById('parks-list')!
  list.innerHTML = tripParks.map((p, i) => `
    <div class="chip" draggable="true" data-idx="${i}">
      <span>⠿ ${i + 1}. ${p.name}</span>
      <button class="chip-remove" data-idx="${i}">✕</button>
    </div>`).join('')

  list.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const idx = parseInt((btn as HTMLElement).dataset['idx']!)
      tripParks.splice(idx, 1)
      renderParksList()
    })
  })
}

let searchTimeout: ReturnType<typeof setTimeout>
const parkSearch = document.getElementById('park-search') as HTMLInputElement
const parkResults = document.getElementById('park-results')!

parkSearch.addEventListener('input', () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(async () => {
    const query = parkSearch.value.trim()
    if (!query) { parkResults.style.display = 'none'; return }
    const parks = await provider.searchParks(query)
    parkResults.style.display = parks.length ? 'block' : 'none'
    parkResults.innerHTML = parks.slice(0, 8).map(p =>
      `<div class="search-result" data-id="${p.id}" data-name="${p.name}">${p.name}</div>`
    ).join('')
    parkResults.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset['id']!
        const name = (el as HTMLElement).dataset['name']!
        if (!tripParks.find(p => p.id === id)) {
          tripParks.push({ id, name })
          renderParksList()
        }
        parkSearch.value = ''
        parkResults.style.display = 'none'
      })
    })
  }, 250)
})

// Dates
function describeRange(r: DateRange): string {
  if (r.type === 'specific') return `${r.checkIn} → ${r.checkOut}`
  const windows = expandDateRange(r)
  return `Every ${DAY_NAMES[r.startDay]}–${DAY_NAMES[r.endDay]} · ${MONTH_NAMES[r.month]} ${r.year} (${windows.length} stays)`
}

function renderDatesList() {
  const list = document.getElementById('dates-list')!
  list.innerHTML = tripDates.map((d, i) => `
    <div class="chip">
      <span>${describeRange(d)}</span>
      <button class="chip-remove" data-idx="${i}">✕</button>
    </div>`).join('')
  list.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset['idx']!)
      tripDates.splice(idx, 1)
      renderDatesList()
    })
  })
}

// Date mode toggle
document.querySelectorAll('.date-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    dateMode = (btn as HTMLElement).dataset['mode'] as 'specific' | 'recurring'
    document.querySelectorAll('.date-mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('specific-inputs')!.classList.toggle('hidden', dateMode !== 'specific')
    document.getElementById('recurring-inputs')!.classList.toggle('hidden', dateMode !== 'recurring')
  })
})

// Recurring preview
function updateRecurringPreview() {
  const startDay = parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value)
  const endDay = parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value)
  const month = parseInt((document.getElementById('rec-month') as HTMLSelectElement).value)
  const year = parseInt((document.getElementById('rec-year') as HTMLSelectElement).value)
  const windows = expandDateRange({ type: 'recurring', year, month, startDay, endDay })
  document.getElementById('rec-preview')!.textContent =
    `→ ${windows.length} stay${windows.length !== 1 ? 's' : ''}: ${windows[0]?.checkIn ?? ''} to ${windows[windows.length - 1]?.checkOut ?? ''}`
}

['rec-start-day', 'rec-end-day', 'rec-month', 'rec-year'].forEach(id => {
  document.getElementById(id)!.addEventListener('change', updateRecurringPreview)
})
updateRecurringPreview()

document.getElementById('add-date-btn')!.addEventListener('click', () => {
  if (dateMode === 'specific') {
    const checkIn = (document.getElementById('date-checkin') as HTMLInputElement).value
    const checkOut = (document.getElementById('date-checkout') as HTMLInputElement).value
    if (!checkIn || !checkOut) return
    tripDates.push({ type: 'specific', checkIn, checkOut })
  } else {
    const startDay = parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value)
    const endDay = parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value)
    const month = parseInt((document.getElementById('rec-month') as HTMLSelectElement).value)
    const year = parseInt((document.getElementById('rec-year') as HTMLSelectElement).value)
    tripDates.push({ type: 'recurring', year, month, startDay, endDay })
  }
  renderDatesList()
})

// Save trip
document.getElementById('save-trip-btn')!.addEventListener('click', async () => {
  const name = (document.getElementById('trip-name') as HTMLInputElement).value.trim()
  if (!name) { alert('Trip name is required.'); return }
  const mode = (document.getElementById('trip-mode') as HTMLSelectElement).value as Trip['mode']
  const noWalkin = (document.getElementById('filter-walkin') as HTMLInputElement).checked
  const noDouble = (document.getElementById('filter-double') as HTMLInputElement).checked

  const { trips } = await getStorage()
  if (editingTripId) {
    const idx = trips.findIndex(t => t.id === editingTripId)
    if (idx !== -1) {
      trips[idx] = { ...trips[idx], name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'scanning' }
    }
  } else {
    trips.push({ id: crypto.randomUUID(), name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'scanning', lastMatch: null, attempted: [], createdAt: Date.now() })
  }
  await saveTrips(trips)
  document.getElementById('back-btn')!.click()
})

document.getElementById('delete-trip-btn')!.addEventListener('click', async () => {
  if (!editingTripId || !confirm('Delete this trip?')) return
  const { trips } = await getStorage()
  await saveTrips(trips.filter(t => t.id !== editingTripId))
  document.getElementById('back-btn')!.click()
})

// Payment form
async function loadPaymentForm() {
  const { payment } = await getStorage()
  if (!payment) return
  ;(document.getElementById('card-number') as HTMLInputElement).value = payment.cardNumber
  ;(document.getElementById('card-holder') as HTMLInputElement).value = payment.cardHolder
  ;(document.getElementById('card-expiry') as HTMLInputElement).value = payment.cardExpiry
  ;(document.getElementById('card-cvv') as HTMLInputElement).value = payment.cardCvv
  ;(document.getElementById('party-size') as HTMLInputElement).value = String(payment.partySize)
}

document.getElementById('save-payment-btn')!.addEventListener('click', async () => {
  await savePayment({
    cardNumber: (document.getElementById('card-number') as HTMLInputElement).value,
    cardHolder: (document.getElementById('card-holder') as HTMLInputElement).value,
    cardExpiry: (document.getElementById('card-expiry') as HTMLInputElement).value,
    cardCvv: (document.getElementById('card-cvv') as HTMLInputElement).value,
    partySize: parseInt((document.getElementById('party-size') as HTMLInputElement).value) || 1,
  })
  alert('Payment info saved.')
})

// Settings form
async function loadSettingsForm() {
  const { settings } = await getStorage()
  ;(document.getElementById('poll-interval') as HTMLSelectElement).value = String(settings.pollIntervalSeconds)
}

document.getElementById('save-settings-btn')!.addEventListener('click', async () => {
  const val = parseInt((document.getElementById('poll-interval') as HTMLSelectElement).value) as 30 | 60 | 120
  await saveSettings({ pollIntervalSeconds: val })
  alert('Settings saved.')
})

// Init
renderTripList()
loadPaymentForm()
loadSettingsForm()
```

- [ ] **Step 3: Build and verify options page**

```bash
cd campsite-booking/extension && npm run build
```

Reload the extension in Chrome. Right-click the extension icon → "Options". Verify: trip list shows, "+ New Trip" opens editor, park search field is present, date form shows specific/recurring toggle.

- [ ] **Step 4: Commit**

```bash
cd campsite-booking && git add extension/src/options/ && git commit -m "feat(extension): add options page with trip editor, park search, and date picker"
```

---

## Task 10: Content Script — Auto-pay Checkout

**Files:**
- Create: `extension/src/content/bcparks.ts`

> **Note:** Step 5 (surcharges page) and Step 6 (occupant details page) selectors are marked with `// TODO: verify selector`. Before implementing, go through BC Parks checkout steps 5 and 6 and paste the HTML source here so the exact button/field selectors can be filled in. Step 7 (payment page) selectors are confirmed: `#cardNumber`, `#cardHolderName`, `#cardExpiry`, `#cardCvv`, `#applyPaymentButton`.

- [ ] **Step 1: Implement the content script**

```typescript
// extension/src/content/bcparks.ts

// Only activate when the extension opened this tab for auto-pay
chrome.storage.session.get('autopayTripId', async ({ autopayTripId }) => {
  if (!autopayTripId) return
  await runCheckout(autopayTripId as string)
})

async function waitForElement(selector: string, timeoutMs = 10_000): Promise<Element> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const el = document.querySelector(selector)
      if (el) { clearInterval(interval); resolve(el) }
      if (Date.now() - start > timeoutMs) { clearInterval(interval); reject(new Error(`Timeout waiting for ${selector}`)) }
    }, 300)
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
      // Step 5 — surcharges page: click Continue
      // TODO: verify selector by inspecting live checkout step 5 HTML
      await clickWhenReady('[data-test="continue-button"], button.continue-btn, button[type="submit"]')
      return
    }

    if (url.includes('occupant') || url.includes('step6') || url.includes('details')) {
      // Step 6 — occupant details: fill party size if needed and continue
      // TODO: verify selectors by inspecting live checkout step 6 HTML
      await clickWhenReady('[data-test="continue-button"], button.continue-btn, button[type="submit"]')
      return
    }

    if (url.includes('payment') || url.includes('step7')) {
      // Step 7 — payment page (selectors confirmed from live HTML inspection)
      const { payment } = await new Promise<{ payment: { cardNumber: string; cardHolder: string; cardExpiry: string; cardCvv: string } }>(resolve =>
        chrome.storage.local.get('payment', resolve as (items: Record<string, unknown>) => void)
      )
      if (!payment) throw new Error('No payment info configured')

      await fillInput('#cardNumber', payment.cardNumber)
      await fillInput('#cardHolderName', payment.cardHolder)
      await fillInput('#cardExpiry', payment.cardExpiry)
      await fillInput('#cardCvv', payment.cardCvv)

      await clickWhenReady('#applyPaymentButton')

      // Wait for confirmation page
      const confirmEl = await waitForElement('[class*="confirmation"], [class*="booking-ref"], h1', 15_000)
      const confirmationNumber = confirmEl.textContent?.trim() ?? 'unknown'

      chrome.runtime.sendMessage({ type: 'BOOKING_CONFIRMED', tripId, confirmationNumber })
    }
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'BOOKING_FAILED', tripId, error: String(err) })
  }
}
```

- [ ] **Step 2: Wire tripId from service worker to content script**

In `extension/src/background/index.ts`, update the autopay case inside `handleMatch()` to store the tripId in session storage before opening the tab:

```typescript
// In handleMatch(), replace the autopay block:
if (trip.mode === 'autopay') {
  await new Promise<void>(resolve => chrome.storage.session.set({ autopayTripId: trip.id }, resolve))
  await chrome.tabs.create({ url: checkoutUrl })
  await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
}
```

- [ ] **Step 3: Handle BOOKING_FAILED in service worker**

Add to the `chrome.runtime.onMessage` listener in `extension/src/background/index.ts`:

```typescript
chrome.runtime.onMessage.addListener((msg: { type: string; tripId?: string; confirmationNumber?: string; error?: string }) => {
  if (msg.type === 'BOOKING_CONFIRMED' && msg.tripId) {
    updateTrip(msg.tripId, { status: 'completed' }).then(() => {
      notify('Booking Confirmed!', `Confirmation: ${msg.confirmationNumber ?? 'unknown'}`)
    })
  }
  if (msg.type === 'BOOKING_FAILED' && msg.tripId) {
    updateTrip(msg.tripId, { status: 'paused' }).then(() => {
      notify('Payment Failed', msg.error ?? 'Unknown error — check BC Parks tab.')
    })
  }
})
```

- [ ] **Step 4: Build**

```bash
cd campsite-booking/extension && npm run build
```

Expected: Build succeeds with `dist/content.js`.

- [ ] **Step 5: Manual test (once a real site is found)**

With a site held in cart:
1. Ensure payment info is saved in Options → Payment
2. Navigate manually to `https://camping.bcparks.ca/create-booking/reservationmessages`
3. Open DevTools → Console — look for any errors from the content script
4. Fill in the TODO selectors for steps 5-6 from the live HTML, rebuild, and test end-to-end

- [ ] **Step 6: Commit**

```bash
cd campsite-booking && git add extension/src/content/bcparks.ts extension/src/background/index.ts && git commit -m "feat(extension): add auto-pay content script for checkout automation"
```

---

## Task 11: E2E Smoke Test

**Files:**
- Create: `extension/e2e/extension.test.ts`

- [ ] **Step 1: Create E2E test**

```typescript
// extension/e2e/extension.test.ts
import { test, expect, chromium } from '@playwright/test'
import path from 'path'

const EXTENSION_PATH = path.resolve(__dirname, '../dist')

test('popup renders trip list', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  })

  // Get extension ID
  let extensionId = ''
  for (const page of context.pages()) {
    const url = page.url()
    if (url.startsWith('chrome-extension://')) {
      extensionId = url.split('/')[2]
      break
    }
  }
  if (!extensionId) {
    const bg = await context.waitForEvent('page')
    extensionId = bg.url().split('/')[2]
  }

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await expect(popup.locator('text=CampSniper')).toBeVisible()
  await expect(popup.locator('text=New Trip')).toBeVisible()

  await context.close()
})
```

- [ ] **Step 2: Install Playwright browsers**

```bash
cd campsite-booking/extension && npx playwright install chromium
```

- [ ] **Step 3: Create playwright.config.ts**

```typescript
// extension/playwright.config.ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'e2e',
  use: { headless: false },
})
```

- [ ] **Step 4: Run E2E test**

```bash
cd campsite-booking/extension && npm run test:e2e
```

Expected: Chrome opens, extension loads, popup shows "CampSniper" and "+ New Trip".

- [ ] **Step 5: Commit**

```bash
cd campsite-booking && git add extension/e2e/ extension/playwright.config.ts && git commit -m "test(extension): add E2E smoke test for popup"
```

---

## Task 12: Final Polish and .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update .gitignore**

Add to `campsite-booking/.gitignore`:
```
extension/node_modules/
extension/dist/
.superpowers/
```

- [ ] **Step 2: Run full test suite**

```bash
cd campsite-booking/extension && npm test
```

Expected: All unit tests PASS.

- [ ] **Step 3: Final build**

```bash
cd campsite-booking/extension && npm run build
```

Load `dist/` in Chrome. Create a test trip with park search and a specific date. Verify popup shows the trip with Scanning status.

- [ ] **Step 4: Final commit**

```bash
cd campsite-booking && git add .gitignore && git commit -m "chore: ignore extension build artifacts and superpowers cache"
```
