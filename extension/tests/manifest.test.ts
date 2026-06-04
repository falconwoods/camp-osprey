import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('extension manifest', () => {
  it('requests unlimited storage for long-running local logs', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))

    expect(manifest.permissions).toContain('unlimitedStorage')
  })

  it('allows the server pages to message the extension', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))

    expect(manifest.externally_connectable.matches).toEqual(expect.arrayContaining([
      'https://campsoon.com/*',
      'https://*.campsoon.com/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]))
  })
})
