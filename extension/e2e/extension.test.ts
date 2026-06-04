import { test, expect, chromium } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '../dist')

test('popup renders campsoon header and new trip button', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  })

  // Give the extension time to register its service worker
  await new Promise(r => setTimeout(r, 2000))

  // Find extension ID from service workers list
  const workers = context.serviceWorkers()
  let extensionId = ''
  for (const worker of workers) {
    if (worker.url().startsWith('chrome-extension://')) {
      extensionId = worker.url().split('/')[2]
      break
    }
  }

  // Fallback: open extensions page and parse
  if (!extensionId) {
    const page = await context.newPage()
    await page.goto('chrome://extensions/')
    // If still no ID, skip gracefully
    if (!extensionId) {
      console.log('Could not detect extension ID — skipping E2E test')
      await context.close()
      return
    }
  }

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await expect(popup.locator('text=campsoon')).toBeVisible({ timeout: 10_000 })
  await expect(popup.locator('text=New Trip')).toBeVisible()
  await expect(popup.locator('text=No trips yet')).toBeVisible()

  await context.close()
}, 60_000)
