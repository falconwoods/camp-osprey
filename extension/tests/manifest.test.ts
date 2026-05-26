import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('extension manifest', () => {
  it('requests unlimited storage for long-running local logs', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))

    expect(manifest.permissions).toContain('unlimitedStorage')
  })
})
