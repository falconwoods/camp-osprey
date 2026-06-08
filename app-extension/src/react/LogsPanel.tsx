import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_LOG_LEVELS, EMPTY_DEBUG_LOG_MESSAGE, filterDebugLog, formatDebugLogAsJsonl, MAX_RENDERED_DEBUG_LOG_ROWS } from '../debugLog'
import { clearDebugLog } from '../storage'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LoadingButton } from '../components/ui/loading-button'
import type { DebugLogEntry, LogLevel } from '../types'

export function LogsPanel({ logs, onChanged }: { logs: DebugLogEntry[]; onChanged: () => Promise<void> }) {
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(ALL_LOG_LEVELS))
  const [autoScroll, setAutoScroll] = useState(true)
  const [copyLabel, setCopyLabel] = useState('Copy JSONL')
  const [loading, setLoading] = useState<'refresh' | 'copy' | 'clear' | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)
  const filteredLogs = useMemo(() => filterDebugLog(logs, levels), [logs, levels])
  const visibleLogs = filteredLogs.slice(-MAX_RENDERED_DEBUG_LOG_ROWS)
  const hiddenCount = filteredLogs.length - visibleLogs.length

  useEffect(() => {
    if (autoScroll && tableRef.current) {
      tableRef.current.scrollTop = tableRef.current.scrollHeight
    }
  }, [autoScroll, visibleLogs.length])

  function toggleLevel(level: LogLevel) {
    const next = new Set(levels)
    if (next.has(level)) next.delete(level)
    else next.add(level)
    setLevels(next)
  }

  async function clear() {
    setLoading('clear')
    try {
      await clearDebugLog()
      await onChanged()
    } finally {
      setLoading(null)
    }
  }

  async function copyJsonl() {
    setLoading('copy')
    try {
      await navigator.clipboard.writeText(formatDebugLogAsJsonl(logs, levels))
      setCopyLabel('Copied')
      window.setTimeout(() => setCopyLabel('Copy JSONL'), 1200)
    } finally {
      setLoading(null)
    }
  }

  async function refresh() {
    setLoading('refresh')
    try {
      await onChanged()
    } finally {
      setLoading(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
      </CardHeader>
      <CardContent className="stack">
        <div className="logs-toolbar">
          <div className="log-filter-group" aria-label="Log level filters">
            {ALL_LOG_LEVELS.map(level => (
              <button
                key={level}
                className={levels.has(level) ? 'active' : ''}
                type="button"
                onClick={() => toggleLevel(level)}
              >
                {level}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} />
            Auto-scroll
          </label>
        </div>
        <div className="button-row">
          <LoadingButton variant="secondary" onClick={refresh} loading={loading === 'refresh'} loadingText="Refreshing...">Refresh</LoadingButton>
          <LoadingButton variant="secondary" onClick={copyJsonl} loading={loading === 'copy'} loadingText="Copying...">{copyLabel}</LoadingButton>
          <LoadingButton variant="destructive" onClick={clear} loading={loading === 'clear'} loadingText="Clearing...">Clear</LoadingButton>
        </div>
        <div className="debug-log-table" ref={tableRef} role="table" aria-label="Debug log">
          <div className="debug-log-row debug-log-header" role="row">
            <div role="columnheader">Time</div>
            <div role="columnheader">Level</div>
            <div role="columnheader">Event</div>
            <div role="columnheader">Message</div>
          </div>
          {hiddenCount > 0 ? (
            <div className="debug-log-empty">
              Showing newest {visibleLogs.length.toLocaleString()} of {filteredLogs.length.toLocaleString()} matching local log entries.
            </div>
          ) : null}
          {visibleLogs.length ? visibleLogs.map((log, index) => (
            <div className={`debug-log-row debug-log-${log.level} ${milestoneClass(log)}`} role="row" key={`${log.ts}-${index}`}>
              <div role="cell" title={log.ts}>{formatLogTimestamp(log.ts)}</div>
              <div role="cell" className="debug-log-level">{log.level.toUpperCase()}</div>
              <div role="cell">{log.event}</div>
              <div role="cell">{formatLogDetail(log)}</div>
            </div>
          )) : (
            <div className="debug-log-empty">{EMPTY_DEBUG_LOG_MESSAGE}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function formatLogTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString()
}

function formatLogDetail(entry: DebugLogEntry): string {
  const metadata = renderMetadata(entry)
  return [entry.message, metadata].filter(Boolean).join(' ')
}

function renderMetadata(entry: DebugLogEntry): string {
  const metadataPairs: Array<[string, unknown]> = []
  const fields: Array<keyof DebugLogEntry> = ['tripName', 'parkName', 'siteName', 'checkIn', 'checkOut', 'bookingDate', 'status', 'error']
  for (const field of fields) {
    const value = entry[field]
    if (hasValue(value)) metadataPairs.push([field, value])
  }
  if (entry.metadata) {
    for (const [key, value] of Object.entries(entry.metadata)) {
      if (hasValue(value)) metadataPairs.push([key, value])
    }
  }
  return metadataPairs.map(([key, value]) => `${key}="${formatMetadataValue(value)}"`).join(' ')
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function formatMetadataValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
}

function milestoneClass(entry: DebugLogEntry): string {
  if (entry.event === 'site_found' || entry.status === 'found') return 'debug-log-found'
  if (entry.event === 'booking_reserved' || entry.status === 'reserved') return 'debug-log-reserved'
  if (entry.event === 'booking_paid' || entry.status === 'paid') return 'debug-log-paid'
  if (entry.event === 'booking_failed' || entry.status === 'failed') return 'debug-log-failed'
  return ''
}
