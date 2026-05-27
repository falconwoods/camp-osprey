import type { DebugLogEntry, LogLevel } from './types'

export const EMPTY_DEBUG_LOG_MESSAGE = 'No log entries match the selected filters.'
export const ALL_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error']

const METADATA_FIELDS: Array<keyof DebugLogEntry> = [
  'tripName',
  'parkName',
  'siteName',
  'checkIn',
  'checkOut',
  'bookingDate',
  'status',
  'error',
]

export function filterDebugLog(entries: DebugLogEntry[], levels: Set<LogLevel>): DebugLogEntry[] {
  return entries.filter(entry => levels.has(entry.level))
}

export function renderDebugLogRows(entries: DebugLogEntry[], levels: Set<LogLevel>): string {
  const filtered = filterDebugLog(entries, levels)

  if (filtered.length === 0) {
    return `<div class="log-empty">${escapeHtml(EMPTY_DEBUG_LOG_MESSAGE)}</div>`
  }

  return filtered.map(entry => {
    const rowClasses = [
      'log-row',
      `log-row--${entry.level}`,
      milestoneClass(entry),
    ].filter(Boolean).join(' ')
    const metadata = renderMetadata(entry)

    return [
      `<div class="${escapeHtml(rowClasses)}">`,
      `<span class="log-row__time">${escapeHtml(entry.ts)}</span>`,
      `<span class="log-row__level">${escapeHtml(entry.level.toUpperCase())}</span>`,
      `<span class="log-row__event">${escapeHtml(entry.event)}</span>`,
      `<span class="log-row__message">${escapeHtml(entry.message)}</span>`,
      metadata ? `<span class="log-row__metadata">${metadata}</span>` : '',
      '</div>',
    ].join('')
  }).join('')
}

export function formatDebugLogAsJsonl(entries: DebugLogEntry[], levels: Set<LogLevel>): string {
  return filterDebugLog(entries, levels)
    .map(entry => JSON.stringify(entry))
    .join('\n')
}

export function formatDebugLog(entries: DebugLogEntry[]): string {
  return formatDebugLogAsJsonl(entries, new Set(ALL_LOG_LEVELS))
}

function renderMetadata(entry: DebugLogEntry): string {
  const metadataPairs: Array<[string, unknown]> = []

  for (const field of METADATA_FIELDS) {
    const value = entry[field]
    if (hasValue(value)) {
      metadataPairs.push([field, value])
    }
  }

  if (entry.metadata) {
    for (const [key, value] of Object.entries(entry.metadata)) {
      if (hasValue(value)) {
        metadataPairs.push([key, value])
      }
    }
  }

  return metadataPairs
    .map(([key, value]) => `${escapeHtml(key)}=&quot;${escapeHtml(formatMetadataValue(value))}&quot;`)
    .join(' ')
}

function milestoneClass(entry: DebugLogEntry): string | null {
  if (entry.event === 'site_found' || entry.status === 'found') {
    return 'log-row--found'
  }

  if (entry.event === 'booking_reserved' || entry.status === 'reserved') {
    return 'log-row--reserved'
  }

  if (entry.event === 'booking_paid' || entry.status === 'paid') {
    return 'log-row--paid'
  }

  if (entry.event === 'booking_failed' || entry.status === 'failed') {
    return 'log-row--failed'
  }

  return null
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value) ?? String(value)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}
