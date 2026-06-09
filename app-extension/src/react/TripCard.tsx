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
import { describeRange, formatDateTime, matchLine, statusDisplay } from './format'

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

  function editTrip() {
    onEdit?.(trip)
  }

  function shouldIgnoreCardActivation(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('button, a, input, select, textarea, [data-trip-card-action]'))
  }

  function handleCardClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!onEdit || shouldIgnoreCardActivation(event.target)) return
    editTrip()
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!onEdit || shouldIgnoreCardActivation(event.target)) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    editTrip()
  }

  return (
    <Card
      className={`trip-card trip-${trip.status}${compact ? ' trip-card-compact' : ''}${onEdit ? ' trip-card-clickable' : ''}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      aria-label={onEdit ? `Edit ${trip.name}` : undefined}
    >
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
                <Button className="trip-action-button trip-action-primary" variant="secondary" onClick={() => chrome.tabs.create({ url: trip.lastMatch!.bookingUrl })} data-trip-card-action>
                  {trip.status === 'reserved' ? 'Finish Checkout' : 'Reserve Now'} <ExternalLink size={18} />
                </Button>
              ) : null}
              {canPause ? (
                <LoadingButton className="trip-action-button trip-action-success" variant="secondary" onClick={pauseTrip} loading={pausing} loadingText="Pausing..." data-trip-card-action>
                  <Pause size={18} /> Pause
                </LoadingButton>
              ) : null}
              {canStart ? (
                <LoadingButton className="trip-action-button trip-action-success" variant="secondary" onClick={startTrip} loading={starting} loadingText="Starting..." data-trip-card-action>
                  {trip.status === 'reserved' || trip.status === 'paid' ? <RefreshCw size={18} /> : <Play size={18} />}
                  {trip.status === 'reserved' || trip.status === 'paid' ? 'Scan Again' : 'Start'}
                </LoadingButton>
              ) : null}
              {onEdit ? (
                <Button className="trip-action-button trip-action-icon-on-tight" variant="secondary" onClick={editTrip} aria-label="Edit trip" title="Edit trip" data-trip-card-action>
                  <Edit3 size={18} />
                  <span className="trip-action-label">Edit</span>
                </Button>
              ) : null}
              {onDelete ? (
                <LoadingButton className="trip-action-button trip-action-icon-on-tight" variant="secondary" onClick={deleteTrip} loading={deleting} loadingText="Deleting..." aria-label="Delete trip" title="Delete trip" data-trip-card-action>
                  <Trash2 size={18} />
                  <span className="trip-action-label">Delete</span>
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
