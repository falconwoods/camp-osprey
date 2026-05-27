# Structured Log Viewer Design

## Context

The extension currently stores scan logs as plain strings in `chrome.storage.local.debugLog` and renders them as a small plain-text box in the Settings tab. This makes the log hard to filter, color, search, export, or forward to a log service later.

This change adds a dedicated Logs tab in the Options page and changes new logs to structured objects only. Existing string logs do not need migration and will be discarded when logs are next written or cleared.

## Goals

- Add a full log viewer page in the Options UI.
- Keep the compact toolbar visual style from the mockup.
- Add an auto-scroll toggle that scrolls to the newest log when enabled.
- Increase usable log height by moving the viewer out of Settings and into its own tab.
- Color log rows by severity and highlight campsite milestones.
- Filter by `debug`, `info`, `warning`, and `error`.
- Store logs in a structured format that can later be sent to a log service without changing the schema.
- Copy filtered logs as JSONL for search and ingestion testing.

## Non-Goals

- No external log endpoint or remote log-service integration.
- No migration of existing plain string logs.
- No advanced text search in this pass.
- No separate browser extension page outside the existing Options page.

## Data Model

`debugLog` becomes an array of structured entries:

```ts
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type BookingStatus = 'found' | 'reserved' | 'paid' | 'failed'

export interface DebugLogEntry {
  ts: string
  level: LogLevel
  event: string
  message: string
  tripId?: string
  tripName?: string
  parkName?: string
  siteName?: string
  checkIn?: string
  checkOut?: string
  foundAt?: string
  reservedAt?: string
  paidAt?: string
  bookingDate?: string
  status?: BookingStatus
  error?: string
  metadata?: Record<string, unknown>
}
```

`ts` is always the time the log entry is written. `checkIn` and `checkOut` are the campsite stay dates. `bookingDate` is a searchable milestone timestamp for booking-related events:

| Event | bookingDate |
| --- | --- |
| `site_found` | `foundAt` |
| `booking_reserved` | `reservedAt` |
| `booking_paid` | `paidAt` |
| `booking_failed` | `ts` unless a better milestone timestamp is available |

## Logging API

`addDebugLog` will accept a structured input instead of a plain string:

```ts
addDebugLog({
  level: 'info',
  event: 'site_found',
  message: 'Found reservable site',
  tripId,
  tripName,
  parkName,
  siteName,
  checkIn,
  checkOut,
  foundAt,
  bookingDate: foundAt,
  status: 'found',
})
```

The helper will add `ts` when not supplied, preserve the existing write queue, and cap the array at `MAX_DEBUG_LOG_ENTRIES`. If the current stored log array contains old strings, the helper will drop them before appending structured entries.

Log events should use stable snake_case names so they are easy to match in JSONL and future log services. Examples include `scan_cycle_started`, `scan_skipped`, `trip_scan_started`, `park_checked`, `availability_result`, `site_found`, `reservation_tab_opened`, `match_failed`, `booking_reserved`, `booking_paid`, `booking_failed`, `notification_error`, `server_result_reported`, and `server_email_failed`.

## UI

The Options page gets a new top-level `Logs` tab beside Trips, Payment, Settings, and Account.

The Logs tab uses the compact toolbar style:

- Header: `Scan Log`.
- Right-side controls: Auto scroll checkbox, Copy JSONL button, Clear button.
- Level filter chips: Debug, Info, Warning, Error.
- Full-height log viewer below the toolbar.
- Empty state when no entries match the selected filters.

Rows render in a compact table-like layout:

- Timestamp.
- Level.
- Event.
- Message and key metadata.

Severity colors:

- `debug`: cool blue.
- `info`: green or neutral, with stronger green for successful campsite events.
- `warning`: amber.
- `error`: red.

Milestone emphasis:

- `site_found`: green highlight.
- `booking_reserved`: green highlight with `reserved` status.
- `booking_paid`: green highlight with `paid` status.
- `booking_failed`: red highlight.

Auto-scroll defaults to enabled each time the Options page loads. When enabled, rendering new logs scrolls the viewer to the bottom. When disabled, filtering and refreshes do not force-scroll.

Copy JSONL exports the currently filtered entries as newline-delimited JSON, one entry per line. Clear removes all entries from local storage and refreshes the view.

## Data Flow

1. Background scanner and content-script events write structured logs with `addDebugLog`.
2. Logs are stored in `chrome.storage.local.debugLog`.
3. The Logs tab reads entries through `getStorage`.
4. The formatter filters by selected levels and renders row HTML.
5. Copy JSONL serializes the filtered structured entries.
6. Clear calls `clearDebugLog` and rerenders the empty state.

## Error Handling

- If stored logs are not structured entries, they are ignored and replaced by the next write.
- Unknown levels are not valid; TypeScript should catch them.
- Copy failure should preserve the existing button text and surface a browser alert or console error.
- Rendering must escape user-controlled strings such as trip names, park names, site names, and error messages.

## Testing

Unit tests:

- `addDebugLog` writes structured entries with `ts`, caps history, serializes concurrent writes, and drops old string logs.
- `formatDebugLog` or replacement helpers filter by selected levels.
- JSONL export includes only filtered entries.
- Empty state renders when no entries match.

Options tests:

- Logs tab exists and can be selected.
- Level chips filter visible rows.
- Auto-scroll scrolls to the bottom when enabled and does not force-scroll when disabled.
- Clear empties logs.

Background tests:

- Existing log assertions should update from string matching to structured event assertions for important events: scan cycle, site found, reservation held, booking paid, booking failed, and notification errors.
