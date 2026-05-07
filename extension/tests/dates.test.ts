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

  it('returns single-night stays for all Saturdays in August 2026 (7-night span)', () => {
    const result = expandDateRange({ type: 'recurring', year: 2026, month: 8, startDay: DAY.SAT, endDay: DAY.SAT })
    // Aug 2026: Sat Aug 1, 8, 15, 22, 29
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ checkIn: '2026-08-01', checkOut: '2026-08-08' })
  })

  it('handles month where first weekday is early in the month', () => {
    // Feb 2026 starts on Sunday. First Monday is Feb 2.
    const result = expandDateRange({ type: 'recurring', year: 2026, month: 2, startDay: DAY.MON, endDay: DAY.MON })
    expect(result.every(r => r.checkIn.startsWith('2026-02'))).toBe(true)
    expect(result[0].checkIn).toBe('2026-02-02')
  })
})
