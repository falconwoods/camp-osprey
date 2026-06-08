import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { savePayment } from '../storage'
import { getTrips, updateTrip } from '../tripStore'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { LoadingButton } from '../components/ui/loading-button'
import type { AuthState, PaymentConfig, Trip } from '../types'
import { isValidParkPayment } from './tripActions'

type PaymentForm = {
  cardNumber: string
  cardHolder: string
  cardExpiry: string
  cardCvv: string
  billingAddress: string
  billingPostal: string
}

const emptyPayment: PaymentForm = {
  cardNumber: '',
  cardHolder: '',
  cardExpiry: '',
  cardCvv: '',
  billingAddress: '',
  billingPostal: '',
}

export function PaymentPanel({
  auth,
  payment,
  onChanged,
  onSignIn,
}: {
  auth: AuthState | null
  payment: PaymentConfig | null
  onChanged: () => Promise<void>
  onSignIn: () => void
}) {
  const [form, setForm] = useState<PaymentForm>(payment ?? emptyPayment)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState<'save' | 'delete' | null>(null)

  useEffect(() => setForm(payment ?? emptyPayment), [payment])

  const signedIn = Boolean(auth?.user)
  const update = (key: keyof PaymentForm, value: string) => setForm({ ...form, [key]: value })

  function validPayment(): PaymentConfig | null {
    const normalized = { ...form, cardNumber: form.cardNumber.replace(/\D/g, ''), cardExpiry: form.cardExpiry.replace(/\s/g, ''), billingPostal: form.billingPostal.toUpperCase() }
    if (!/^\d{13,19}$/.test(normalized.cardNumber) || !passesLuhn(normalized.cardNumber)) return setErrorAndNull('Enter a valid card number.')
    if (!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(normalized.cardHolder)) return setErrorAndNull('Enter the name on the card.')
    if (!isValidExpiry(normalized.cardExpiry)) return setErrorAndNull('Enter a future expiry date as MM/YY.')
    if (!/^\d{3,4}$/.test(normalized.cardCvv)) return setErrorAndNull('Enter a 3 or 4 digit CVV.')
    if (normalized.billingAddress.trim().length < 5) return setErrorAndNull('Enter a billing address.')
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(normalized.billingPostal)) return setErrorAndNull('Enter a valid postal or zip code.')
    setError('')
    return normalized
  }

  function setErrorAndNull(message: string): null {
    setError(message)
    return null
  }

  async function save() {
    const next = validPayment()
    if (!next) return
    setLoading('save')
    try {
      await savePayment(next)
      setSaved(true)
      await onChanged()
    } finally {
      setLoading(null)
    }
  }

  async function remove() {
    setLoading('delete')
    try {
      const trips = await getTrips()
      const activeAutoPayTrips = trips.filter(isActiveAutoPayTrip)
      if (!confirm(activeAutoPayTrips.length ? `Delete payment info and pause ${activeAutoPayTrips.length} active auto-pay trips?` : 'Delete saved park payment info from this device?')) return
      await savePayment(null)
      await Promise.all(activeAutoPayTrips.map(trip => updateTrip(trip.id, { status: 'paused' })))
      activeAutoPayTrips.forEach(trip => chrome.runtime.sendMessage({ type: 'STOP_SCAN', tripId: trip.id }))
      chrome.storage.local.remove('campOspreyTarget')
      setForm(emptyPayment)
      await onChanged()
    } finally {
      setLoading(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Park Payment</CardTitle>
      </CardHeader>
      <CardContent className="stack">
        <div className="local-note"><Lock size={16} /> Stored locally on this device only. Used only for BC Parks auto-pay checkout.</div>
        {!signedIn ? (
          <div className="alert-inline warn">
            Sign in to add or edit payment information.
            <Button size="sm" onClick={onSignIn}>Sign in</Button>
          </div>
        ) : null}
        <div className="form-grid">
          <Field label="Card number"><Input disabled={!signedIn} value={form.cardNumber} onChange={e => update('cardNumber', e.target.value)} inputMode="numeric" autoComplete="cc-number" /></Field>
          <Field label="Name on card"><Input disabled={!signedIn} value={form.cardHolder} onChange={e => update('cardHolder', e.target.value)} autoComplete="cc-name" /></Field>
          <Field label="Expiry date"><Input disabled={!signedIn} value={form.cardExpiry} onChange={e => update('cardExpiry', e.target.value)} placeholder="MM/YY" autoComplete="cc-exp" /></Field>
          <Field label="CVV"><Input disabled={!signedIn} value={form.cardCvv} onChange={e => update('cardCvv', e.target.value)} type="password" inputMode="numeric" autoComplete="cc-csc" /></Field>
          <Field label="Billing address" className="span-2"><Input disabled={!signedIn} value={form.billingAddress} onChange={e => update('billingAddress', e.target.value)} /></Field>
          <Field label="Postal / Zip code" className="span-2"><Input disabled={!signedIn} value={form.billingPostal} onChange={e => update('billingPostal', e.target.value)} /></Field>
        </div>
        {error ? <div className="alert-inline error">{error}</div> : null}
        {saved && isValidParkPayment(form) ? <div className="alert-inline success">Payment info saved.</div> : null}
        <div className="button-row">
          <Button variant="secondary" onClick={() => setForm(payment ?? emptyPayment)}>Cancel</Button>
          {payment ? <LoadingButton variant="destructive" onClick={remove} loading={loading === 'delete'} loadingText="Deleting...">Delete Payment Info</LoadingButton> : null}
          <LoadingButton onClick={save} disabled={!signedIn} loading={loading === 'save'} loadingText="Saving...">Save Payment Info</LoadingButton>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={`field ${className ?? ''}`}><Label>{label}</Label>{children}</div>
}

function isActiveAutoPayTrip(trip: Trip): boolean {
  return trip.mode === 'autopay' && (trip.status === 'scanning' || trip.status === 'reserving')
}

function isValidExpiry(value: string): boolean {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value)
  if (!match) return false
  const year = 2000 + Number(match[2])
  const month = Number(match[1])
  const now = new Date()
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)
}

function passesLuhn(cardNumber: string): boolean {
  let sum = 0
  let doubleDigit = false
  for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumber[i])
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}
