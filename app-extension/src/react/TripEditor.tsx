import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Filter, Settings2, Tag, Trash2, Zap } from 'lucide-react'
import { BCParksProvider } from '../providers/bcparks'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { LoadingButton } from '../components/ui/loading-button'
import { Select } from '../components/ui/select'
import { APP_CONFIG } from '../config'
import type { DateRange, Park, Trip } from '../types'
import { describeRange, statusDisplay } from './format'
import { isValidParkPayment, saveTripDraft, startTripNow } from './tripActions'

const provider = new BCParksProvider()
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const successfulBookingPointCostLabel = APP_CONFIG.points.successfulBookingPointCost.toLocaleString()

export function TripEditor({
  trip,
  paymentValid,
  tripCount,
  onClose,
  onSaved,
  onDelete,
  onNeedsAuth,
  onNeedsPayment,
}: {
  trip: Trip | null
  paymentValid: boolean
  tripCount: number
  onClose: () => void
  onSaved: () => Promise<void>
  onDelete: (trip: Trip) => Promise<void>
  onNeedsAuth: () => void
  onNeedsPayment: () => void
}) {
  const [name, setName] = useState(trip?.name ?? `Trip ${tripCount + 1}`)
  const [mode, setMode] = useState<Trip['mode']>(trip?.mode ?? 'reserve')
  const [noWalkin, setNoWalkin] = useState(trip?.filters.noWalkin ?? true)
  const [noDouble, setNoDouble] = useState(trip?.filters.noDouble ?? true)
  const [parks, setParks] = useState<Park[]>(trip?.parks ?? [])
  const [dateRanges, setDateRanges] = useState<DateRange[]>(trip?.dateRanges ?? [])
  const [dateMode, setDateMode] = useState<'specific' | 'recurring'>('specific')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [recYear, setRecYear] = useState(new Date().getFullYear())
  const [recMonth, setRecMonth] = useState(new Date().getMonth() + 1)
  const [recStart, setRecStart] = useState(4)
  const [recEnd, setRecEnd] = useState(6)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Park[]>([])
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<'save' | 'start' | 'delete' | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const id = setTimeout(() => {
      void provider.searchParks(query.trim()).then(parks => setResults(parks.slice(0, 8))).catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  const years = useMemo(() => {
    const year = new Date().getFullYear()
    return [year, year + 1, year + 2]
  }, [])
  const recurringPreview = useMemo(() => describeRange({
    type: 'recurring',
    year: recYear,
    month: recMonth,
    startDay: recStart,
    endDay: recEnd,
  }), [recYear, recMonth, recStart, recEnd])
  const modeHelpItems = useMemo(() => getModeHelpItems(mode), [mode])

  useEffect(() => {
    if (recEnd <= recStart) setRecEnd(Math.min(recStart + 1, 6))
  }, [recStart, recEnd])

  function addPark(park: Park) {
    if (!parks.some(item => item.id === park.id)) setParks([...parks, park])
    setQuery('')
    setResults([])
    setFieldErrors({ ...fieldErrors, parks: '' })
  }

  function addDateRange() {
    const range: DateRange = dateMode === 'specific'
      ? { type: 'specific', checkIn, checkOut }
      : { type: 'recurring', year: recYear, month: recMonth, startDay: recStart, endDay: recEnd }
    if (dateMode === 'specific' && (!checkIn || !checkOut)) {
      setFieldErrors({ ...fieldErrors, dates: 'Choose both check-in and check-out dates.' })
      return
    }
    if (dateMode === 'specific' && new Date(checkOut) <= new Date(checkIn)) {
      setFieldErrors({ ...fieldErrors, dates: 'Check-out must be after check-in.' })
      return
    }
    if (dateMode === 'recurring' && recEnd <= recStart) {
      setFieldErrors({ ...fieldErrors, dates: 'End day must be after start day.' })
      return
    }
    if (dateRanges.some(existing => dateRangesEqual(existing, range))) {
      setError('Date range already added.')
      return
    }
    setError('')
    setFieldErrors({ ...fieldErrors, dates: '' })
    setDateRanges([...dateRanges, range])
  }

  async function save(startAfterSave: boolean) {
    setError('')
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) nextErrors.name = 'Trip name is required.'
    if (!parks.length) nextErrors.parks = 'Add at least one park to scan.'
    if (!dateRanges.length) nextErrors.dates = 'Add at least one date range.'
    setFieldErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    if (mode === 'autopay' && !paymentValid) {
      onNeedsPayment()
      return
    }
    setSaving(startAfterSave ? 'start' : 'save')
    try {
      const saved = await saveTripDraft({
        existing: trip,
        name: name.trim(),
        mode,
        filters: { noWalkin, noDouble },
        parks,
        dateRanges,
      })
      if (startAfterSave) {
        const result = await startTripNow(saved.id, false)
        if (!result.ok && result.reason === 'server_auth') onNeedsAuth()
        if (!result.ok && result.reason === 'payment') onNeedsPayment()
        if (!result.ok && result.reason === 'bcparks_auth') setError('BC Parks sign-in is required for auto-reserve and auto-pay trips.')
        if (!result.ok) return
      }
      await onSaved()
      onClose()
    } catch (err) {
      if (err instanceof Error && err.message === 'auth_required') onNeedsAuth()
      else setError(err instanceof Error ? err.message : 'Could not save trip.')
    } finally {
      setSaving(null)
    }
  }

  async function deleteTrip() {
    if (!trip) return
    setSaving('delete')
    try {
      await onDelete(trip)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div id="trip-editor" className="trip-editor-shell">
      <div className="editor-page-header">
        <div className="editor-title-row">
          <h1 id="editor-trip-title">{trip ? 'Edit Trip' : 'New Trip'}</h1>
          {trip ? (
            <span id="editor-status-badge" className={`editor-status-badge status-${trip.status}`}>{statusDisplay(trip).title}</span>
          ) : null}
        </div>
        <button className="back-link" id="back-btn" type="button" onClick={onClose}>← All Trips</button>
        <div className="editor-subtitle">Edit trip details and campsite search preferences.</div>
      </div>

      <div className="editor-layout">
        <div className="editor-main">
          <section className="editor-card section">
            <div className="editor-section-title"><Tag size={20} /> Trip Setup</div>

            <div className="editor-field-group" id="section-name">
              <div className="section-label">Trip Name</div>
              <Input id="trip-name" placeholder="e.g. Summer Long Weekend" value={name} onChange={event => {
                setName(event.target.value)
                if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: '' })
              }} />
              <div className={`field-error ${fieldErrors.name ? 'show' : ''}`} id="error-name">{fieldErrors.name}</div>
            </div>

            <div className="editor-field-group" id="section-parks">
              <div className="section-label">Parks <small>(drag to reorder priority)</small></div>
              <div id="parks-list">
                {parks.map((park, index) => (
                  <div className="chip park-chip" draggable="true" key={park.id}>
                    <span className="park-drag-handle" aria-hidden="true">⠿</span>
                    <span className="park-priority">{index + 1}.</span>
                    <span className="park-name">{park.name}</span>
                    <button className="chip-remove" type="button" aria-label={`Remove ${park.name}`} onClick={() => setParks(parks.filter(item => item.id !== park.id))}>×</button>
                  </div>
                ))}
              </div>
              <div className="park-add-row">
                <Input
                  id="park-search"
                  placeholder="Search or add parks..."
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      if (results[0]) addPark(results[0])
                    }
                  }}
                />
                <Button id="park-add-btn" type="button" onClick={() => results[0] && addPark(results[0])}>Add</Button>
              </div>
              <div className="search-results" id="park-results" style={{ display: results.length ? 'block' : 'none' }}>
                {results.map(park => <button className="search-result" key={park.id} type="button" onClick={() => addPark(park)}>{park.name}</button>)}
              </div>
              <div className={`field-error ${fieldErrors.parks ? 'show' : ''}`} id="error-parks">{fieldErrors.parks}</div>
            </div>
          </section>

          <section className={`editor-card section ${fieldErrors.dates ? 'section-invalid' : ''}`} id="section-dates">
            <div className="editor-section-title"><CalendarDays size={20} /> Date Ranges</div>
            <div id="dates-list">
              {dateRanges.map((range, index) => (
                <div className="range-summary" key={`${range.type}-${index}`}>
                  <span>{describeRange(range)}</span>
                  <button className="chip-remove" type="button" aria-label="Remove date range" onClick={() => setDateRanges(dateRanges.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              ))}
            </div>
            <div className={`field-error ${fieldErrors.dates ? 'show' : ''}`} id="error-dates">{fieldErrors.dates}</div>
            <div className="date-form">
              <div className="date-mode-toggle">
                <button className={`date-mode-btn ${dateMode === 'specific' ? 'active' : ''}`} type="button" data-mode="specific" onClick={() => setDateMode('specific')}>Specific dates</button>
                <button className={`date-mode-btn ${dateMode === 'recurring' ? 'active' : ''}`} type="button" data-mode="recurring" onClick={() => setDateMode('recurring')}>Flexible (any weekend)</button>
              </div>
              <div className="date-form-body">
                <div id="specific-inputs" className={dateMode === 'specific' ? '' : 'hidden'}>
                  <div className="row">
                    <div className="date-field"><div className="section-label">Check-in</div><Input id="date-checkin" type="date" value={checkIn} onChange={event => setCheckIn(event.target.value)} /></div>
                    <div className="date-field"><div className="section-label">Check-out</div><Input id="date-checkout" type="date" value={checkOut} onChange={event => setCheckOut(event.target.value)} /></div>
                  </div>
                </div>
                <div id="recurring-inputs" className={dateMode === 'recurring' ? '' : 'hidden'}>
                  <div className="row recurring-row">
                    <span>Any</span>
                    <Select id="rec-start-day" value={recStart} onChange={event => setRecStart(Number(event.target.value))}>{dayNames.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select>
                    <span>to</span>
                    <Select id="rec-end-day" value={recEnd} onChange={event => setRecEnd(Number(event.target.value))}>{dayNames.map((day, index) => index > recStart ? <option key={day} value={index}>{day}</option> : null)}</Select>
                    <span>in</span>
                    <Select id="rec-month" value={recMonth} onChange={event => setRecMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2026, index, 1).toLocaleDateString(undefined, { month: 'long' })}</option>)}</Select>
                    <Select id="rec-year" value={recYear} onChange={event => setRecYear(Number(event.target.value))}>{years.map(year => <option key={year} value={year}>{year}</option>)}</Select>
                  </div>
                  <div className="preview" id="rec-preview">{recurringPreview}</div>
                </div>
                <Button id="add-date-btn" type="button" onClick={addDateRange}>+ Add This Range</Button>
              </div>
            </div>
          </section>
        </div>

        <aside className="editor-side-panel">
          <div className="editor-side-heading">Booking Settings</div>
          <section className="editor-side-section">
            <div className="editor-section-title"><Settings2 size={18} /> Match Behavior</div>
            <div className="section-label">On Match</div>
            <Select id="trip-mode" value={mode} onChange={event => setMode(event.target.value as Trip['mode'])}>
              <option value="alert">Alert Only</option>
              <option value="reserve">Auto-reserve</option>
              <option value="autopay">Auto-pay</option>
            </Select>
            <div className="mode-help" id="trip-mode-help" aria-live="polite">
              <strong>{modeLabel(mode)}</strong>
              <ul>
                {modeHelpItems.map(item => <li key={item}>{item}</li>)}
              </ul>
              {mode === 'autopay' ? <div className="mode-help-action"><span>Auto-pay requires payment info in Settings &gt; Park Payment.</span><button type="button" onClick={onNeedsPayment}>Set up Park Payment</button></div> : null}
            </div>
          </section>

          <section className="editor-side-section">
            <div className="editor-section-title"><Filter size={18} /> Filters</div>
            <div className="editor-filters">
              <label className="checkbox-label"><input id="filter-walkin" type="checkbox" checked={noWalkin} onChange={event => setNoWalkin(event.target.checked)} /> No walk-in</label>
              <label className="checkbox-label"><input id="filter-double" type="checkbox" checked={noDouble} onChange={event => setNoDouble(event.target.checked)} /> No double</label>
            </div>
          </section>

          <section className="editor-side-section">
            <div className="editor-section-title"><Zap size={18} /> Actions</div>
            <div className="editor-action-stack">
              <LoadingButton id="save-trip-btn" variant="secondary" type="button" onClick={() => save(false)} disabled={Boolean(saving)} loading={saving === 'save'} loadingText="Saving...">Save Trip</LoadingButton>
              <LoadingButton id="start-trip-btn" type="button" onClick={() => save(true)} disabled={Boolean(saving)} loading={saving === 'start'} loadingText="Starting...">Save and Start</LoadingButton>
              {trip ? <LoadingButton id="delete-trip-btn" variant="destructive" type="button" onClick={deleteTrip} disabled={Boolean(saving)} loading={saving === 'delete'} loadingText="Deleting..."><Trash2 size={15} /> Delete Trip</LoadingButton> : null}
            </div>
          </section>
        </aside>
      </div>
      {error ? <div className="alert-inline error editor-error">{error}</div> : null}
    </div>
  )
}

function dateRangesEqual(a: DateRange, b: DateRange): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'specific' && b.type === 'specific') return a.checkIn === b.checkIn && a.checkOut === b.checkOut
  if (a.type === 'recurring' && b.type === 'recurring') {
    return a.year === b.year && a.month === b.month && a.startDay === b.startDay && a.endDay === b.endDay
  }
  return false
}

function modeLabel(mode: Trip['mode']): string {
  return { alert: 'Alert Only', reserve: 'Auto-reserve', autopay: 'Auto-pay' }[mode]
}

function getModeHelpItems(mode: Trip['mode']): string[] {
  if (mode === 'alert') {
    return [
      'Sends an alert when a matching site is found.',
      'Free: no points are deducted.',
    ]
  }

  if (mode === 'reserve') {
    return [
      'Reserves a matching site for you to complete payment manually.',
      `${successfulBookingPointCostLabel} points are deducted only after you successfully pay the reservation.`,
    ]
  }

  return [
    'Reserves the site and completes payment automatically.',
    `${successfulBookingPointCostLabel} points are deducted only after reservation and payment both succeed.`,
  ]
}
