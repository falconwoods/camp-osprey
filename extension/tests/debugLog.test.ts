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
      entry({ event: 'booking_reserved', status: 'reserved' }),
      entry({ event: 'booking_paid', status: 'paid' }),
      entry({ level: 'error', event: 'booking_failed', status: 'failed' }),
    ], new Set<LogLevel>(['info', 'error']))

    expect(html).toContain('log-row--found')
    expect(html).toContain('log-row--reserved')
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
