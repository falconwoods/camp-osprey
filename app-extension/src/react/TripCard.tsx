import {
  AlertTriangle,
  Bell,
  Calendar,
  CreditCard,
  Edit3,
  ExternalLink,
  Gauge,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { LoadingButton } from '../components/ui/loading-button'
import { getTripWarnings } from '../warnings'
import type { DateRange, Trip } from '../types'
import { describeRange, formatDateTime, matchLine, modeLabel } from './format'

export function TripCard({
  trip,
  compact = false,
  onEdit,
  onStart,
  onPause,
  onDelete,
}: {
  trip: Trip
  compact?: boolean
  onEdit?: (trip: Trip) => void
  onStart: (trip: Trip) => void | Promise<void>
  onPause: (trip: Trip) => void | Promise<void>
  onDelete?: (trip: Trip) => void | Promise<void>
}) {
  const [starting, setStarting] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const warnings = getTripWarnings(trip)
  const parks = trip.parks.map(park => park.name).join(', ') || 'No parks'
  const dateSummary = conciseDateSummary(trip.dateRanges)
  const fullDateSummary = trip.dateRanges.map(describeRange).join(', ') || 'No dates selected'
  const status = statusDisplay(trip)
  const mode = modeDisplay(trip.mode)
  const canPause = trip.status === 'scanning'
  const canStart = ['idle', 'paused', 'failed', 'reserved', 'paid'].includes(trip.status)

  async function startTrip() {
    if (starting) return
    setStarting(true)
    try {
      await onStart(trip)
    } finally {
      setStarting(false)
    }
  }

  async function pauseTrip() {
    if (pausing) return
    setPausing(true)
    try {
      await onPause(trip)
    } finally {
      setPausing(false)
    }
  }

  async function deleteTrip() {
    if (!onDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete(trip)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className={`trip-card trip-${trip.status}${compact ? ' trip-card-compact' : ''}`}>
      <CardContent className="trip-card-content">
        <div className="trip-card-main">
          {/* Park image intentionally hidden until per-park imagery is available. */}

          <div className="trip-summary">
            <h3>{trip.name}</h3>
            <div className="trip-meta-row">
              <MapPin size={17} />
              <span>{parks}</span>
            </div>
            <div className="trip-meta-row">
              <Calendar size={17} />
              <span title={fullDateSummary}>{dateSummary}</span>
            </div>
          </div>

          <div className="trip-mode-slot">
            <span className={`mode-pill mode-${trip.mode}`}>
              {mode.icon}
              {mode.label}
            </span>
          </div>

          <div className="trip-status-panel">
            <div className="trip-status-copy">
              <div className={`trip-status-heading status-${trip.status}`}>
                <span className="status-dot" />
                <strong>{status.title}</strong>
              </div>
              <p>{status.detail}</p>
              <span>{status.time}</span>
            </div>

            <div className="trip-actions-row">
              {trip.lastMatch?.bookingUrl && trip.status !== 'paid' ? (
                <Button className="trip-action-button trip-action-primary" variant="secondary" onClick={() => chrome.tabs.create({ url: trip.lastMatch!.bookingUrl })}>
                  {trip.status === 'reserved' ? 'Finish Checkout' : 'Reserve Now'} <ExternalLink size={18} />
                </Button>
              ) : null}
              {canPause ? (
                <LoadingButton className="trip-action-button trip-action-success" variant="secondary" onClick={pauseTrip} loading={pausing} loadingText="Pausing...">
                  <Pause size={18} /> Pause
                </LoadingButton>
              ) : null}
              {canStart ? (
                <LoadingButton className="trip-action-button trip-action-success" variant="secondary" onClick={startTrip} loading={starting} loadingText="Starting...">
                  {trip.status === 'reserved' || trip.status === 'paid' ? <RefreshCw size={18} /> : <Play size={18} />}
                  {trip.status === 'reserved' || trip.status === 'paid' ? 'Scan Again' : 'Start'}
                </LoadingButton>
              ) : null}
              {onEdit ? <Button className="trip-action-button" variant="secondary" onClick={() => onEdit(trip)}><Edit3 size={18} /> Edit</Button> : null}
              {onDelete ? (
                <LoadingButton className="trip-action-button trip-action-danger" variant="destructive" onClick={deleteTrip} loading={deleting} loadingText="Deleting...">
                  <Trash2 size={18} /> Delete
                </LoadingButton>
              ) : null}
            </div>
          </div>
        </div>

        {warnings.length ? (
          <div className="warning-list">
            {warnings.map((warning, index) => (
              <div className={`alert-inline ${warning.level}`} key={index}>
                <AlertTriangle size={15} />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : null}
        {trip.lastMatch ? (
          <div className="match-panel">
            <div className="strong-text">{matchLine(trip.lastMatch)}</div>
            <div className="muted">
              {trip.lastMatch.checkIn} to {trip.lastMatch.checkOut}
              {trip.lastMatch.paidAt ? ` / Paid ${formatDateTime(trip.lastMatch.paidAt)}` : ''}
              {trip.lastMatch.reservedAt ? ` / Reserved ${formatDateTime(trip.lastMatch.reservedAt)}` : ''}
              {trip.lastMatch.foundAt ? ` / Found ${formatDateTime(trip.lastMatch.foundAt)}` : ''}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function conciseDateSummary(ranges: DateRange[]): string {
  if (!ranges.length) return 'No dates'
  const [first, ...rest] = ranges
  const suffix = rest.length ? ` +${rest.length}` : ''
  return `${conciseRange(first)}${suffix}`
}

function conciseRange(range: DateRange): string {
  if (range.type === 'recurring') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const month = new Date(range.year, range.month - 1, 1).toLocaleDateString(undefined, { month: 'short' })
    return `${days[range.startDay]}-${days[range.endDay]} ${month}`
  }

  const checkIn = parseLocalDate(range.checkIn)
  const checkOut = parseLocalDate(range.checkOut)
  const inMonth = checkIn.toLocaleDateString(undefined, { month: 'short' })
  const outMonth = checkOut.toLocaleDateString(undefined, { month: 'short' })
  const inDay = checkIn.getDate()
  const outDay = checkOut.getDate()
  const year = checkIn.getFullYear()

  if (checkIn.getFullYear() === checkOut.getFullYear() && checkIn.getMonth() === checkOut.getMonth()) {
    return `${inMonth} ${inDay}-${outDay}`
  }
  if (checkIn.getFullYear() === checkOut.getFullYear()) {
    return `${inMonth} ${inDay}-${outMonth} ${outDay}`
  }
  return `${inMonth} ${inDay}, ${year}-${outMonth} ${outDay}, ${checkOut.getFullYear()}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function modeDisplay(mode: Trip['mode']): { label: string; icon: React.ReactNode } {
  return {
    alert: { label: 'Alert only', icon: <Bell size={17} /> },
    hold: { label: 'Auto-reserve', icon: <Gauge size={17} /> },
    autopay: { label: 'Auto-pay', icon: <CreditCard size={17} /> },
  }[mode]
}

function statusDisplay(trip: Trip): { title: string; detail: string; time: string } {
  const lastActivity = trip.lastMatch?.paidAt ?? trip.lastMatch?.reservedAt ?? trip.lastMatch?.foundAt
  const checkedAt = lastActivity ?? (trip.updatedAt ? new Date(trip.updatedAt).toISOString() : '')
  const updated = checkedAt ? formatDateTime(checkedAt) : ''
  const time = checkedAt ? `Last checked ${relativeTime(checkedAt)}` : 'Not checked yet'

  if (trip.status === 'scanning') return { title: 'Monitoring', detail: 'Checking availability', time }
  if (trip.status === 'paused') return { title: 'Paused', detail: 'Will notify you when a site becomes available', time }
  if (trip.status === 'reserved' || trip.status === 'paid') {
    const confirmedAt = lastActivity ? formatDateTime(lastActivity) : ''
    return {
      title: trip.status === 'paid' ? 'Paid' : 'Booked',
      detail: trip.status === 'paid' ? 'Payment confirmed' : 'Booking confirmed',
      time: confirmedAt || updated || 'Reservation confirmed',
    }
  }
  if (trip.status === 'reserving') return { title: 'Reserving', detail: 'Completing reservation', time }
  if (trip.status === 'failed') return { title: 'Failed', detail: 'Needs attention before scanning', time }
  return { title: 'Ready', detail: `Ready to start ${modeLabel(trip.mode)}`, time }
}

function relativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return formatDateTime(value)
  if (diffMs < 30_000) return 'just now'

  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  return formatDateTime(value)
}
