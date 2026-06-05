#!/usr/bin/env node

import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'

const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|session|csrf|xsrf|password|passcode|card|cvv|cvc|expiry|expir|payment|billing|address|street|postal|zip|email|phone|holder|name)/i
const TEXT_BODY_TYPES = /(?:json|text|html|xml|x-www-form-urlencoded)/i
const MAX_BODY_CHARS = 120_000

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(extensionDir, '..')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage:
  cd extension
  npm run record:bcparks-checkout

Environment:
  CAMPSOON_RECORD_START_URL  URL to open first (default: https://camping.bcparks.ca/)
  CAMPSOON_RECORD_DIR        Output directory (default: ../dump/bcparks-checkout-recordings/<timestamp>)
`)
  process.exit(0)
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

const runDir = path.resolve(
  process.env.CAMPSOON_RECORD_DIR
    ?? path.join(repoRoot, 'dump', 'bcparks-checkout-recordings', timestampSlug()),
)
const snapshotsDir = path.join(runDir, 'dom-snapshots')
const networkPath = path.join(runDir, 'network.ndjson')
const eventsPath = path.join(runDir, 'events.ndjson')
const startUrl = process.env.CAMPSOON_RECORD_START_URL || 'https://camping.bcparks.ca/'

function redactUrl(value) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    return url.toString()
  } catch {
    return redactText(String(value))
  }
}

function redactText(value) {
  return String(value)
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_CARD]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\+?\d[\d ().-]{8,}\d/g, '[REDACTED_PHONE]')
    .replace(
      /(["']?[^"'=&\s]*(?:authorization|cookie|token|secret|session|csrf|xsrf|password|passcode|card|cvv|cvc|expiry|expir|payment|billing|address|street|postal|zip|email|phone|holder|name)[^"'=&\s]*["']?\s*[:=]\s*)(["'][^"']*["']|[^&\s,}]+)/gi,
      '$1[REDACTED]',
    )
}

function redactHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactText(value),
    ]),
  )
}

function trimBody(value) {
  if (!value) return value
  const redacted = redactText(value)
  if (redacted.length <= MAX_BODY_CHARS) return redacted
  return `${redacted.slice(0, MAX_BODY_CHARS)}\n...[TRUNCATED ${redacted.length - MAX_BODY_CHARS} chars]`
}

async function appendJson(file, value) {
  await fs.appendFile(file, `${JSON.stringify(value)}\n`)
}

async function writeEvent(type, data = {}) {
  await appendJson(eventsPath, {
    ts: new Date().toISOString(),
    type,
    ...data,
  })
}

let requestSeq = 0
const requestIds = new WeakMap()

async function sanitizedDom(page) {
  const html = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true)
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())

    clone.querySelectorAll('input, textarea').forEach(el => {
      el.setAttribute('value', '[REDACTED_INPUT]')
      if ('value' in el) el.value = '[REDACTED_INPUT]'
    })

    clone.querySelectorAll('select').forEach(el => {
      el.setAttribute('data-selected-value', '[REDACTED_SELECT]')
    })

    clone.querySelectorAll('iframe').forEach(el => {
      if (el.hasAttribute('src')) el.setAttribute('src', '[REDACTED_IFRAME_SRC]')
      el.textContent = ''
    })

    return `<!doctype html>\n${clone.outerHTML}`
  })
  return redactText(html)
}

let snapshotSeq = 0
let lastSnapshotUrl = ''

async function snapshot(page, reason) {
  try {
    const url = page.url()
    const html = await sanitizedDom(page)
    const file = `${String(++snapshotSeq).padStart(3, '0')}-${reason.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.html`
    await fs.writeFile(path.join(snapshotsDir, file), html)
    await writeEvent('dom_snapshot', {
      reason,
      file,
      url: redactUrl(url),
      title: redactText(await page.title().catch(() => '')),
    })
    lastSnapshotUrl = url
  } catch (err) {
    await writeEvent('snapshot_failed', { reason, error: String(err) })
  }
}

async function main() {
  await fs.mkdir(snapshotsDir, { recursive: true })
  await fs.writeFile(networkPath, '')
  await fs.writeFile(eventsPath, '')

  console.log(`Recording sanitized BC Parks checkout artifacts to:\n${runDir}\n`)
  console.log('A browser will open. Complete the booking manually, including payment.')
  console.log('When the BC Parks confirmation page is visible, return here and press Enter.\n')

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()

  page.on('request', request => {
    const id = ++requestSeq
    requestIds.set(request, id)
    void appendJson(networkPath, {
      ts: new Date().toISOString(),
      id,
      phase: 'request',
      method: request.method(),
      resourceType: request.resourceType(),
      url: redactUrl(request.url()),
      headers: redactHeaders(request.headers()),
      postData: trimBody(request.postData() ?? ''),
    }).catch(err => console.warn('request log failed:', err))
  })

  page.on('response', response => {
    void (async () => {
      const request = response.request()
      const headers = response.headers()
      const contentType = headers['content-type'] ?? ''
      let body
      if (TEXT_BODY_TYPES.test(contentType)) {
        try {
          body = trimBody(await response.text())
        } catch (err) {
          body = `[BODY_UNAVAILABLE: ${String(err)}]`
        }
      }
      await appendJson(networkPath, {
        ts: new Date().toISOString(),
        id: requestIds.get(request) ?? null,
        phase: 'response',
        status: response.status(),
        statusText: response.statusText(),
        url: redactUrl(response.url()),
        headers: redactHeaders(headers),
        body,
      })
    })().catch(err => console.warn('response log failed:', err))
  })

  page.on('domcontentloaded', () => void snapshot(page, 'domcontentloaded'))
  page.on('load', () => void snapshot(page, 'load'))
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) void snapshot(page, 'navigation')
  })

  const urlPoll = setInterval(() => {
    if (page.url() !== lastSnapshotUrl) void snapshot(page, 'url-change')
  }, 1000)

  await writeEvent('recording_started', { startUrl: redactUrl(startUrl), runDir })
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' })

  const rl = readline.createInterface({ input, output })
  await rl.question('Press Enter after the paid booking confirmation page appears...')
  rl.close()

  await snapshot(page, 'manual-finish')
  clearInterval(urlPoll)

  await fs.writeFile(path.join(runDir, 'summary.json'), JSON.stringify({
    recordedAt: new Date().toISOString(),
    startUrl: redactUrl(startUrl),
    artifacts: {
      network: path.relative(runDir, networkPath),
      events: path.relative(runDir, eventsPath),
      domSnapshots: path.relative(runDir, snapshotsDir),
    },
    note: 'Artifacts are best-effort redacted. Review before sharing externally.',
  }, null, 2))

  await writeEvent('recording_finished', { finalUrl: redactUrl(page.url()) })
  await browser.close()

  console.log(`\nDone. Artifacts saved in:\n${runDir}`)
}

main().catch(async err => {
  console.error(err)
  try {
    await writeEvent('recording_crashed', { error: String(err) })
  } catch {
    // ignore
  }
  process.exit(1)
})
