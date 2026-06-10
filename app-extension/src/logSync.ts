import { PENDING_SERVER_LOGS_KEY } from './storage'
import { sendExtensionLogs } from './serverApi'
import type { DebugLogEntry } from './types'

export const LOG_SYNC_BATCH_SIZE = 300
let flushQueue = Promise.resolve(false)

function promisify<T>(fn: (callback: (result: T) => void) => void): Promise<T> {
  return new Promise(resolve => fn(resolve))
}

function isDebugLogEntry(value: unknown): value is DebugLogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<DebugLogEntry>
  return typeof entry.ts === 'string' &&
    (entry.level === 'debug' || entry.level === 'info' || entry.level === 'warning' || entry.level === 'error') &&
    (typeof entry.eventCode === 'number' || typeof entry.event === 'string') &&
    typeof entry.message === 'string'
}

export async function getPendingServerLogs(): Promise<DebugLogEntry[]> {
  const result = await promisify<Record<string, unknown>>(cb =>
    chrome.storage.local.get([PENDING_SERVER_LOGS_KEY], cb)
  )
  const pending = result[PENDING_SERVER_LOGS_KEY]
  return Array.isArray(pending) ? pending.filter(isDebugLogEntry) : []
}

async function savePendingServerLogs(entries: DebugLogEntry[]): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ [PENDING_SERVER_LOGS_KEY]: entries }, cb))
}

async function flushPendingServerLogsNow(): Promise<boolean> {
  const pending = await getPendingServerLogs()
  if (pending.length === 0) return true

  const batch = pending.slice(0, LOG_SYNC_BATCH_SIZE)
  await sendExtensionLogs(batch)

  const latest = await getPendingServerLogs()
  await savePendingServerLogs(latest.slice(batch.length))
  return true
}

export function flushPendingServerLogs(): Promise<boolean> {
  const result = flushQueue.then(flushPendingServerLogsNow, flushPendingServerLogsNow)
    .catch(() => false)
  flushQueue = result
  return result
}
