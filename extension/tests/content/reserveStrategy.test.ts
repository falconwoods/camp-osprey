import { describe, it, expect } from 'vitest'
import { reservePasses, extractCampsiteName, extractSelectedCampsiteName } from '../../src/content/reserveStrategy'

describe('reservePasses', () => {
  it('uses any eligible site immediately in speed-first mode', () => {
    expect(reservePasses()).toEqual(['any'])
  })
})

describe('extractCampsiteName', () => {
  it('extracts alphanumeric campsite names from panel text', () => {
    expect(extractCampsiteName('Campsite H10 Available Details')).toBe('H10')
  })
})

describe('extractSelectedCampsiteName', () => {
  it('prefers the panel body over shifted header text', () => {
    expect(extractSelectedCampsiteName('Campsite A20 Available', 'Campsite A22 Available')).toBe('A20')
  })
})
