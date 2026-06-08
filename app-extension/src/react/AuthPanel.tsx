import { useEffect, useState } from 'react'
import { Clock, Lock, Send, ShieldCheck } from 'lucide-react'
import { requestCode, signOut, verifyCode } from '../auth'
import { createPointCheckout, getPointsSummary, type PointsSummary } from '../serverApi'
import { consumePendingStartTripId, getPendingStartTripId } from '../startAuthGate'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { LoadingButton } from '../components/ui/loading-button'
import type { AuthState } from '../types'

const RESEND_COOLDOWN_SECONDS = 60

function authMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_email: 'Enter a valid email address.',
    invalid_code: 'That code did not work. Check the code and try again.',
    expired_code: 'This code has expired. Request a new code to continue.',
    rate_limited: 'Too many attempts. Wait a bit, then try again.',
    account_blocked: 'This account cannot use campsoon. Contact support if this seems wrong.',
  }
  return map[code] ?? 'Cannot reach campsoon right now. Try again in a moment.'
}

export function SignInPanel({
  auth,
  onChanged,
  onTripReady,
  titleId,
}: {
  auth: AuthState | null
  onChanged: () => Promise<void>
  onTripReady?: (tripId: string) => Promise<void>
  titleId?: string
}) {
  const [email, setEmail] = useState(auth?.lastEmail ?? '')
  const [code, setCode] = useState('')
  const [sentEmail, setSentEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [resendRemaining, setResendRemaining] = useState(0)

  useEffect(() => {
    if (resendRemaining <= 0) return
    const timer = window.setInterval(() => {
      setResendRemaining(value => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendRemaining])

  async function sendCode() {
    setLoading('send')
    setError('')
    try {
      await requestCode({ email })
      setSentEmail(email)
      setResendRemaining(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(authMessage(err instanceof Error ? err.message : 'server_error'))
    } finally {
      setLoading(null)
    }
  }

  async function verify() {
    setLoading('verify')
    setError('')
    try {
      await verifyCode({ email: sentEmail || email, code })
      const pendingTripId = await consumePendingStartTripId()
      await onChanged()
      if (pendingTripId) await onTripReady?.(pendingTripId)
    } catch (err) {
      setError(authMessage(err instanceof Error ? err.message : 'server_error'))
    } finally {
      setLoading(null)
    }
  }

  function updateCodeDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = code.padEnd(6, ' ').split('').slice(0, 6)
    next[index] = digit || ' '
    setCode(next.join('').replace(/\s/g, ''))
    if (digit && index < 5) document.getElementById(`auth-code-${index + 1}`)?.focus()
  }

  function handleCodePaste(value: string) {
    const pasted = value.replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    setCode(pasted)
    document.getElementById(`auth-code-${Math.min(pasted.length, 6) - 1}`)?.focus()
  }

  function handleCodeKeyDown(index: number, key: string) {
    if (key !== 'Backspace') return
    if (code[index]) return
    if (index > 0) document.getElementById(`auth-code-${index - 1}`)?.focus()
  }

  return (
    <Card>
      <CardHeader>
          <CardTitle id={titleId}>Sign in or create an account</CardTitle>
      </CardHeader>
      <CardContent className="stack">
        {!sentEmail ? (
          <>
            <div className="field">
              <Label htmlFor="auth-email">Email address</Label>
              <Input id="auth-email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
            </div>
            <LoadingButton onClick={sendCode} loading={loading === 'send'} loadingText="Sending...">
              Send email code <Send size={16} />
            </LoadingButton>
            <div className="auth-note"><ShieldCheck size={16} /> Passwordless sign-in</div>
          </>
        ) : (
          <>
            <p className="muted compact-copy">Enter the 6-digit code sent to <strong>{sentEmail}</strong>. Can't find it? Check Spam, Junk, or Trash.</p>
            <div className="field">
              <Label htmlFor="auth-code-0">Verification code</Label>
              <div className="auth-code-inputs" onPaste={event => {
                event.preventDefault()
                handleCodePaste(event.clipboardData.getData('text'))
              }}>
                {Array.from({ length: 6 }, (_, index) => (
                  <Input
                    key={index}
                    id={`auth-code-${index}`}
                    className="auth-code-input"
                    value={code[index] ?? ''}
                    onChange={event => updateCodeDigit(index, event.target.value)}
                    onKeyDown={event => handleCodeKeyDown(index, event.key)}
                    inputMode="numeric"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Verification code digit ${index + 1}`}
                  />
                ))}
              </div>
            </div>
            <LoadingButton onClick={verify} loading={loading === 'verify'} loadingText="Verifying...">
              Verify code
            </LoadingButton>
            <div className="auth-code-actions">
              <LoadingButton className="auth-link auth-resend-link" variant="ghost" type="button" onClick={sendCode} disabled={resendRemaining > 0} loading={loading === 'send'} loadingText="Resending...">
                <Clock size={14} />
                <span>{resendRemaining > 0 ? `Resend code in ${resendRemaining}s` : 'Resend code'}</span>
              </LoadingButton>
              <span className="auth-actions-divider" aria-hidden="true" />
              <button className="auth-link" type="button" onClick={() => {
                setSentEmail('')
                setResendRemaining(0)
              }}>
                Use a different email
              </button>
            </div>
          </>
        )}
        {error ? <div className="alert-inline error">{error}</div> : null}
      </CardContent>
    </Card>
  )
}

export async function hasPendingStart(): Promise<boolean> {
  return Boolean(await getPendingStartTripId())
}

export function AccountPanel({
  auth,
  onChanged,
  onSignIn,
}: {
  auth: AuthState | null
  onChanged: () => Promise<void>
  onSignIn: () => void
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const [points, setPoints] = useState<PointsSummary | null>(null)
  const [pointsError, setPointsError] = useState('')

  useEffect(() => {
    if (!auth?.user) return
    let cancelled = false
    setPoints(null)
    setPointsError('')
    void getPointsSummary()
      .then(summary => { if (!cancelled) setPoints(summary) })
      .catch(err => { if (!cancelled) setPointsError(err instanceof Error ? err.message : 'server_error') })
    return () => { cancelled = true }
  }, [auth?.user])

  async function logOut() {
    setLoading('signout')
    await signOut()
    await onChanged()
    setLoading(null)
  }

  if (!auth?.user) {
    return (
      <div className="stack">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="account-summary-row">
            <div>
              <div className="eyebrow">Not signed in</div>
              <p className="muted compact-copy">Sign in to start trips and receive booking updates.</p>
            </div>
            <Button onClick={onSignIn}>Sign in</Button>
          </CardContent>
        </Card>
        <LockedPointsSection onSignIn={onSignIn} />
      </div>
    )
  }

  return (
    <div className="stack">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="account-summary-row">
          <div>
            <div className="eyebrow">Signed in as</div>
            <div className="strong-text">{auth.user.email}</div>
            {auth.user.role && auth.user.role !== 'user' ? <div className="muted">Role: {auth.user.role}</div> : null}
            {typeof auth.pointsBalance === 'number' ? (
              <div className="muted">{auth.pointsBalance.toLocaleString()} points</div>
            ) : null}
          </div>
          <LoadingButton variant="secondary" onClick={logOut} loading={loading === 'signout'} loadingText="Signing out...">
            Sign out
          </LoadingButton>
        </CardContent>
      </Card>
      <PointsSection points={points} error={pointsError} />
    </div>
  )
}

function LockedPointsSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Card>
      <CardContent className="locked-points-card">
        <div className="locked-panel">
          <Lock size={18} />
          <div>
            <div className="eyebrow">Campsoon Points</div>
            <strong>Sign in to buy points</strong>
            <p>Use points to pay for successful auto-bookings. Points are charged only after a campsite is successfully paid.</p>
          </div>
        </div>
        <Button onClick={onSignIn}>Sign in first</Button>
      </CardContent>
    </Card>
  )
}

function PointsSection({ points, error }: { points: PointsSummary | null; error: string }) {
  const [opening, setOpening] = useState<string | null>(null)

  async function buy(packageId: string) {
    setOpening(packageId)
    try {
      const returnUrl = chrome.runtime.getURL('options.html#account')
      const checkout = await createPointCheckout(packageId, returnUrl, chrome.runtime.id)
      chrome.tabs.create({ url: checkout.checkoutUrl })
    } finally {
      setOpening(null)
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="locked-panel">
          <Lock size={18} />
          <div><strong>Could not load points</strong><p>{error}</p></div>
        </CardContent>
      </Card>
    )
  }

  if (!points) {
    return (
      <Card>
        <CardContent className="locked-panel">
          <Clock size={18} />
          <div><strong>Loading points...</strong><p>Fetching your balance and available point packages.</p></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="stack">
      <Card>
        <CardHeader>
          <CardTitle>Buy Points</CardTitle>
        </CardHeader>
        <CardContent className="stack">
          <div className="points-balance">{points.balance.toLocaleString()} points available</div>
          <div className="point-package-grid">
            {points.packages.length ? points.packages.map(pkg => {
              const bookingCount = Math.floor(pkg.points / points.successfulBookingPointCost)
              return (
                <article className={`point-package-card ${pkg.recommended ? 'featured' : ''}`} key={pkg.id}>
                  <div className="point-package-header">
                    <h3>{packageName(pkg.name)}</h3>
                    {pkg.recommended ? <span>Best value</span> : null}
                  </div>
                  <div className="point-package-points">{pkg.points.toLocaleString()} <span>points</span></div>
                  <div className="point-package-price">{formatPriceLabel(pkg.priceLabel)}</div>
                  <p>{bookingEstimate(bookingCount)}</p>
                  <LoadingButton variant={pkg.recommended ? 'default' : 'secondary'} onClick={() => buy(pkg.id)} loading={opening === pkg.id} loadingText="Opening Stripe...">
                    Buy now
                  </LoadingButton>
                </article>
              )
            }) : <p className="muted">No point packages are available.</p>}
          </div>
          <div className="local-note"><Lock size={16} /> Secure checkout with Stripe.</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Point Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {points.recentTransactions.length ? (
            <div className="point-activity">
              {[...points.recentTransactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(tx => (
                <div className="point-activity-row" key={tx.id}>
                  <div><strong>{transactionLabel(tx.type)}</strong><span>{formatTransactionDateTime(tx.createdAt)}</span></div>
                  <div className={tx.pointsDelta >= 0 ? 'points-earned' : 'points-spent'}>{tx.pointsDelta > 0 ? '+' : ''}{tx.pointsDelta.toLocaleString()}</div>
                  <div>{tx.balanceAfter.toLocaleString()} after</div>
                  <div>{tx.details?.trim() || transactionDetails(tx.type)}</div>
                </div>
              ))}
            </div>
          ) : <p className="muted">No point activity yet.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function packageName(name: string): string {
  return name.toLowerCase().includes('package') ? name : `${name} Package`
}

function bookingEstimate(bookingCount: number): string {
  if (bookingCount <= 0) return 'Good for getting started'
  if (bookingCount === 1) return 'Enough for 1 successful booking'
  return `Enough for ${bookingCount.toLocaleString()} successful bookings`
}

function formatPriceLabel(priceLabel: string): string {
  const match = priceLabel.trim().match(/^([A-Z]{3})\s+(.+)$/)
  if (!match) return priceLabel
  const [, currency, value] = match
  const amount = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(amount)) return priceLabel
  const symbol = currency === 'CAD' || currency === 'USD' ? '$' : ''
  return `${currency} ${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 })}`
}

function transactionLabel(type: string): string {
  return type.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function transactionDetails(type: string): string {
  if (type === 'booking_charge') return 'Successful booking deduction'
  if (type === 'stripe_purchase') return 'Point package purchase'
  if (type === 'stripe_refund') return 'Point package refund'
  return 'Account activity'
}

function formatTransactionDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recent'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
