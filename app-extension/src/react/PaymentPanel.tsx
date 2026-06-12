import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Lock, ShieldCheck } from 'lucide-react'
import { savePayment } from '../storage'
import { getTrips, updateTrip } from '../tripStore'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { LoadingButton } from '../components/ui/loading-button'
import { useConfirmDialog } from '../components/ConfirmDialog'
import type { AuthState, PaymentConfig, Trip } from '../types'
import { isValidParkPayment } from './tripActions'
import { RuntimeMessageCode } from '../protocol'
import { decryptParkPayment, encryptParkPayment, isEncryptedPaymentConfig, isPlainPaymentConfig } from '../paymentCrypto'

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
  const [form, setForm] = useState<PaymentForm>(isPlainPaymentConfig(payment) ? payment : emptyPayment)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PaymentForm, string>>>({})
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState<'save' | 'delete' | null>(null)
  const [sensitiveRevealed, setSensitiveRevealed] = useState(false)
  const [savedForm, setSavedForm] = useState<PaymentForm | null>(isPlainPaymentConfig(payment) ? payment : null)
  const lastSavedEncryptedPayloadRef = useRef<string | null>(null)
  const confirmation = useConfirmDialog()
  const signedIn = Boolean(auth?.user)
  const hasStoredPayment = Boolean(payment)
  const sensitiveEditable = signedIn && (!hasStoredPayment || sensitiveRevealed)

  useEffect(() => {
    let cancelled = false
    if (!payment) {
      setForm(emptyPayment)
      setSavedForm(null)
      setSensitiveRevealed(true)
      return
    }
    if (isPlainPaymentConfig(payment)) {
      setForm(payment)
      setSavedForm(payment)
      setSensitiveRevealed(false)
      return
    }
    if (!isEncryptedPaymentConfig(payment) || !signedIn) {
      setForm(emptyPayment)
      return
    }
    if (lastSavedEncryptedPayloadRef.current === payment.encryptedPayload) {
      setError('')
      return
    }
    void decryptParkPayment(payment).then(decrypted => {
      if (cancelled) return
      setForm(decrypted)
      setSavedForm(decrypted)
      setSensitiveRevealed(false)
      setError('')
    }).catch(() => {
      if (cancelled) return
      setForm(emptyPayment)
      setError('Could not unlock saved payment info. Please sign in again and retry.')
    })
    return () => { cancelled = true }
  }, [payment, signedIn])

  const update = (key: keyof PaymentForm, value: string) => {
    setForm({ ...form, [key]: value })
    setFieldErrors(errors => ({ ...errors, [key]: undefined }))
    setError('')
    setSaved(false)
  }

  function validPayment(): PaymentForm | null {
    const normalized = { ...form, cardNumber: form.cardNumber.replace(/\D/g, ''), cardExpiry: form.cardExpiry.replace(/\s/g, ''), billingPostal: form.billingPostal.toUpperCase() }
    const errors: Partial<Record<keyof PaymentForm, string>> = {}
    if (!/^\d{13,19}$/.test(normalized.cardNumber) || !passesLuhn(normalized.cardNumber)) errors.cardNumber = 'Enter a valid card number.'
    if (!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(normalized.cardHolder)) errors.cardHolder = 'Enter the name on the card.'
    if (!isValidExpiry(normalized.cardExpiry)) errors.cardExpiry = 'Enter a future expiry date as MM/YY.'
    if (!/^\d{3,4}$/.test(normalized.cardCvv)) errors.cardCvv = 'Enter a 3 or 4 digit CVV.'
    if (normalized.billingAddress.trim().length < 5) errors.billingAddress = 'Enter a billing address.'
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(normalized.billingPostal)) errors.billingPostal = 'Enter a valid postal or zip code.'

    const firstError = Object.values(errors)[0]
    if (firstError) {
      setFieldErrors(errors)
      return setErrorAndNull(firstError)
    }
    setFieldErrors({})
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
      const encrypted = await encryptParkPayment(next)
      lastSavedEncryptedPayloadRef.current = encrypted.encryptedPayload
      await savePayment(encrypted)
      setForm(next)
      setSavedForm(next)
      setSensitiveRevealed(false)
      setSaved(true)
      await onChanged()
    } catch {
      setError('Could not securely save payment info. Please sign in again and retry.')
    } finally {
      setLoading(null)
    }
  }

  async function remove() {
    const trips = await getTrips()
    const activeAutoPayTrips = trips.filter(isActiveAutoPayTrip)
    const confirmed = await confirmation.confirm({
      title: 'Delete payment info?',
      message: activeAutoPayTrips.length
        ? `Deleting payment info will pause ${activeAutoPayTrips.length} active auto-pay ${activeAutoPayTrips.length === 1 ? 'trip' : 'trips'}.`
        : 'Delete saved Park Payment info from this device?',
      confirmLabel: 'Delete payment info',
      variant: 'destructive',
    })
    if (!confirmed) return
    setLoading('delete')
    try {
      await savePayment(null)
      await Promise.all(activeAutoPayTrips.map(trip => updateTrip(trip.id, { status: 'paused' })))
      activeAutoPayTrips.forEach(trip => chrome.runtime.sendMessage({ t: RuntimeMessageCode.stopScan, tripId: trip.id }))
      chrome.storage.local.remove('campOspreyTarget')
      setForm(emptyPayment)
      setSavedForm(null)
      setSensitiveRevealed(true)
      setSaved(false)
      await onChanged()
    } finally {
      setLoading(null)
    }
  }

  function cancelSensitiveEdit() {
    setForm(savedForm ?? emptyPayment)
    setFieldErrors({})
    setError('')
    setSaved(false)
    setSensitiveRevealed(!savedForm)
  }

  return (
    <div className={`payment-card ${signedIn ? '' : 'locked'}`}>
      <div className="payment-card-header">
        <div>
          <div className="payment-title-row">
            <h2>Park Payment</h2>
            <span className="payment-pill"><ShieldCheck size={14} /> Only stored locally on this device.</span>
          </div>
          <p className="payment-copy">Used only in auto-pay mode to complete park booking checkout, not for campsoon app payments.</p>
        </div>
      </div>
      <div className="payment-form">
        {!signedIn ? (
          <div className="payment-info">
            <CircleAlert size={18} />
            <div><strong>Sign in to add or edit payment information.</strong><br />Your payment details are stored locally on this device only.</div>
          </div>
        ) : null}
        <div className="payment-grid">
          <Field id="card-number" label="Card number" error={fieldErrors.cardNumber}>
            <Input id="card-number" className={fieldErrors.cardNumber ? 'invalid' : ''} disabled={!signedIn} readOnly={!sensitiveEditable} value={sensitiveEditable ? form.cardNumber : maskCardNumber(form.cardNumber)} onChange={e => update('cardNumber', e.target.value)} inputMode="numeric" autoComplete="cc-number" maxLength={23} placeholder="Card number" aria-invalid={Boolean(fieldErrors.cardNumber)} aria-describedby="error-card-number" />
          </Field>
          <Field id="card-holder" label="Name on card" error={fieldErrors.cardHolder}>
            <Input id="card-holder" className={fieldErrors.cardHolder ? 'invalid' : ''} disabled={!signedIn} value={form.cardHolder} onChange={e => update('cardHolder', e.target.value)} autoComplete="cc-name" maxLength={80} placeholder="Full name as shown on card" aria-invalid={Boolean(fieldErrors.cardHolder)} aria-describedby="error-card-holder" />
          </Field>
          <Field id="card-expiry" label="Expiry date" error={fieldErrors.cardExpiry}>
            <Input id="card-expiry" className={fieldErrors.cardExpiry ? 'invalid' : ''} disabled={!signedIn} value={form.cardExpiry} onChange={e => update('cardExpiry', e.target.value)} placeholder="MM/YY" inputMode="numeric" autoComplete="cc-exp" maxLength={5} aria-invalid={Boolean(fieldErrors.cardExpiry)} aria-describedby="error-card-expiry" />
          </Field>
          <Field id="card-cvv" label="CVV" error={fieldErrors.cardCvv}>
            <Input id="card-cvv" className={fieldErrors.cardCvv ? 'invalid' : ''} disabled={!signedIn} readOnly={!sensitiveEditable} value={sensitiveEditable ? form.cardCvv : maskCvv(form.cardCvv)} onChange={e => update('cardCvv', e.target.value)} type={sensitiveEditable ? 'text' : 'password'} inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="CVV" aria-invalid={Boolean(fieldErrors.cardCvv)} aria-describedby="error-card-cvv" />
          </Field>
          <Field id="billing-address" label="Billing address" className="payment-field-full" error={fieldErrors.billingAddress}>
            <Input id="billing-address" className={fieldErrors.billingAddress ? 'invalid' : ''} disabled={!signedIn} value={form.billingAddress} onChange={e => update('billingAddress', e.target.value)} autoComplete="billing street-address" maxLength={160} placeholder="Street address" aria-invalid={Boolean(fieldErrors.billingAddress)} aria-describedby="error-billing-address" />
          </Field>
          <Field id="billing-postal" label="Postal / Zip code" className="payment-field-full" error={fieldErrors.billingPostal}>
            <Input id="billing-postal" className={fieldErrors.billingPostal ? 'invalid' : ''} disabled={!signedIn} value={form.billingPostal} onChange={e => update('billingPostal', e.target.value)} autoComplete="billing postal-code" maxLength={12} placeholder="Postal / Zip code" aria-invalid={Boolean(fieldErrors.billingPostal)} aria-describedby="error-billing-postal" />
          </Field>
        </div>
        {error ? <div className="alert-inline error">{error}</div> : null}
        {saved && isValidParkPayment(form) ? <div className="alert-inline success">Payment info saved.</div> : null}
      </div>
      <div className="payment-local-note"><Lock size={14} /> Your payment details are stored locally on this device only.</div>
      <div className="payment-actions">
        {signedIn ? <LoadingButton variant="secondary" onClick={remove} loading={loading === 'delete'} loadingText="Deleting...">Delete Payment Info</LoadingButton> : null}
        {signedIn && sensitiveRevealed ? <Button variant="secondary" onClick={cancelSensitiveEdit}>Cancel</Button> : null}
        {signedIn && hasStoredPayment && !sensitiveRevealed ? <Button variant="secondary" onClick={() => setSensitiveRevealed(true)}>Edit Card Details</Button> : null}
        {signedIn ? (
          <LoadingButton onClick={save} loading={loading === 'save'} loadingText="Saving...">Save Payment Info</LoadingButton>
        ) : (
          <Button onClick={onSignIn}>Sign in to save payment info</Button>
        )}
      </div>
      {confirmation.dialog}
    </div>
  )
}

function Field({ id, label, className, error, children }: { id: string; label: string; className?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className={`payment-field ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      <div className={`field-error ${error ? 'show' : ''}`} id={`error-${id}`}>{error ?? ''}</div>
    </div>
  )
}

function isActiveAutoPayTrip(trip: Trip): boolean {
  return trip.mode === 'autopay' && (trip.status === 'scanning' || trip.status === 'reserving')
}

function maskCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  const last4 = digits.slice(-4)
  return `•••• •••• •••• ${last4}`
}

function maskCvv(value: string): string {
  if (!value) return ''
  return '•••'
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
