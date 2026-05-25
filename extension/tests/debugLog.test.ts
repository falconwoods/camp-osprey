import { describe, expect, it } from 'vitest'
import { formatDebugLog } from '../src/debugLog'

describe('formatDebugLog', () => {
  it('keeps latest entries at the bottom', () => {
    expect(formatDebugLog(['first', 'second', 'third'])).toBe('first\nsecond\nthird')
  })

  it('shows empty state when there are no entries', () => {
    expect(formatDebugLog([])).toBe('No log entries yet — waiting for next scan cycle.')
  })
})
