#!/usr/bin/env node

import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(extensionDir, '..')
const extensionPath = path.join(extensionDir, 'dist')
const fixturePath = path.join(extensionDir, 'fixtures', 'bcparks', 'booking-fail.html')
const fakeUrl = 'https://camping.bcparks.ca/create-booking/payment/create-booking%252Fconfirmation'
const tripId = 'debug-booking-fail-trip'
const closeAfterResult = process.argv.includes('--once')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage:
  cd extension
  npm run build:development
  npm run debug:booking-fail
  npm run debug:booking-fail -- --once

This opens Chromium with the built extension, intercepts:
  ${fakeUrl}

and serves:
  fixtures/bcparks/booking-fail.html

The script seeds chrome.storage.local, waits for the real content script to
detect the payment failure page, then prints the resulting trip status/debug log.
Use --once to close Chromium after the status check.
`)
  process.exit(0)
}

async function pathExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function getExtensionId(context) {
  let [worker] = context.serviceWorkers()
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => null)
  }
  if (!worker?.url().startsWith('chrome-extension://')) {
    throw new Error('Could not detect extension service worker. Run npm run build:development first.')
  }
  return worker.url().split('/')[2]
}

async function extensionStoragePage(context, extensionId) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options/index.html`)
  return page
}

async function main() {
  if (!await pathExists(path.join(extensionPath, 'manifest.json'))) {
    throw new Error(`Built extension not found at ${extensionPath}. Run: npm run build:development`)
  }
  if (!await pathExists(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`)
  }

  const userDataDir = path.join(repoRoot, 'tmp', 'debug-booking-fail-profile')
  await fs.rm(userDataDir, { recursive: true, force: true })
  await fs.mkdir(userDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  await context.route('https://camping.bcparks.ca/**', async route => {
    const url = route.request().url()
    if (url.startsWith(fakeUrl)) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: await fs.readFile(fixturePath, 'utf8'),
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'debug fixture only' })
  })

  await context.route('https://campsoon.com/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, emailSent: false }),
    })
  })

  const extensionId = await getExtensionId(context)
  const storagePage = await extensionStoragePage(context, extensionId)
  const now = Date.now()
  const fakeTrip = {
    id: tripId,
    clientId: 'debug-client',
    name: 'Debug Booking Fail',
    parks: [{ id: '-2147483647', name: 'Alice Lake Provincial Park' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-06-16', checkOut: '2026-06-17' }],
    filters: { noWalkin: true, noDouble: true },
    mode: 'autopay',
    status: 'reserving',
    lastMatch: {
      parkName: 'Alice Lake Provincial Park',
      siteName: '52',
      sectionName: 'Campground',
      checkIn: '2026-06-16',
      checkOut: '2026-06-17',
      bookingUrl: fakeUrl,
      resourceId: '-2147483000',
      foundAt: new Date(now - 30_000).toISOString(),
      reservedAt: new Date(now - 15_000).toISOString(),
    },
    attempted: [],
    createdAt: now - 60_000,
    updatedAt: now,
    deletedAt: null,
  }

  await storagePage.evaluate(({ fakeTrip, now }) => new Promise(resolve => {
    chrome.storage.local.set({
      trips: [fakeTrip],
      auth: { token: null, user: null, lastEmail: null, pointsBalance: null },
      settings: { pollIntervalSeconds: 60, debugMode: true, emailOnSiteFound: false, theme: 'auto', logSyncMinLevel: 'info' },
      debugLog: [],
      campOspreyTarget: {
        resourceId: '-2147483000',
        siteName: '52',
        sectionName: 'Campground',
        parkName: 'Alice Lake Provincial Park',
        tripId: fakeTrip.id,
        mode: 'autopay',
        noDouble: true,
        noWalkin: true,
        checkIn: '2026-06-16',
        checkOut: '2026-06-17',
        availableCount: 1,
        setAt: now,
      },
    }, () => resolve())
  }), { fakeTrip, now })

  const page = await context.newPage()
  page.on('console', msg => console.log(`[page:${msg.type()}] ${msg.text()}`))
  await page.goto(fakeUrl)

  const result = await storagePage.evaluate(({ tripId }) => new Promise(resolve => {
    const deadline = Date.now() + 10_000
    const poll = () => {
      chrome.storage.local.get(['trips', 'debugLog', 'campOspreyTarget'], data => {
        const trip = (data.trips ?? []).find(t => t.id === tripId)
        if (trip?.status === 'failed' || trip?.status === 'paid' || Date.now() > deadline) {
          resolve({
            trip,
            targetExists: !!data.campOspreyTarget,
            debugLog: data.debugLog ?? [],
          })
          return
        }
        setTimeout(poll, 250)
      })
    }
    poll()
  }), { tripId })

  const failedLog = result.debugLog.find(entry => entry.event === 'booking_failed')
  const paidLog = result.debugLog.find(entry => entry.event === 'booking_paid')
  console.log('\nDebug result:')
  console.log(JSON.stringify({
    tripStatus: result.trip?.status,
    paidAt: result.trip?.lastMatch?.paidAt,
    targetExists: result.targetExists,
    failedLog: failedLog ? {
      event: failedLog.event,
      status: failedLog.status,
      error: failedLog.error,
    } : null,
    paidLog: paidLog ? {
      event: paidLog.event,
      status: paidLog.status,
      confirmationNumber: paidLog.metadata?.confirmationNumber,
    } : null,
  }, null, 2))

  if (result.trip?.status !== 'failed' || paidLog) {
    await context.close()
    throw new Error('Fake failure page did not mark the trip failed cleanly')
  }

  if (closeAfterResult) {
    await context.close()
    return
  }

  console.log('\nLeave the browser open for inspection. Press Ctrl+C when done.')
  await new Promise(() => {})
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
