import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CircleAlert, Clock, Gift, Lock, Mail, Send, ShieldCheck } from 'lucide-react'
import { requestCode, signOut, verifyCode } from '../auth'
import {
  getPointTransactions,
  getPointsBalance,
  redeemRechargeCode,
  type PointTransaction,
} from '../serverApi'
import { consumePendingStartTripId, getPendingStartTripId } from '../startAuthGate'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { LoadingButton } from '../components/ui/loading-button'
import { Skeleton } from '../components/ui/skeleton'
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
  const [pointsBalance, setPointsBalance] = useState<number | null>(null)
  const [pointTransactions, setPointTransactions] = useState<PointTransaction[] | null>(null)
  const [balanceError, setBalanceError] = useState('')
  const [transactionsError, setTransactionsError] = useState('')
  const [pendingTripId, setPendingTripId] = useState<string | null>(null)
  const userKey = auth?.user ? auth.user.id || auth.user.email : null

  useEffect(() => {
    if (!userKey) {
      setPointsBalance(null)
      setPointTransactions(null)
      setBalanceError('')
      setTransactionsError('')
      return
    }
    let cancelled = false
    setPointsBalance(null)
    setPointTransactions(null)
    setBalanceError('')
    setTransactionsError('')
    void getPointsBalance()
      .then(summary => { if (!cancelled) setPointsBalance(summary.balance) })
      .catch(err => { if (!cancelled) setBalanceError(err instanceof Error ? err.message : 'server_error') })
    void getPointTransactions()
      .then(summary => { if (!cancelled) setPointTransactions(summary.recentTransactions) })
      .catch(err => { if (!cancelled) setTransactionsError(err instanceof Error ? err.message : 'server_error') })
    return () => { cancelled = true }
  }, [userKey])

  useEffect(() => {
    let cancelled = false
    void getPendingStartTripId().then(tripId => {
      if (!cancelled) setPendingTripId(tripId)
    })
    return () => { cancelled = true }
  }, [userKey])

  async function logOut() {
    setLoading('signout')
    await signOut()
    await onChanged()
    setLoading(null)
  }

  async function refreshPointData() {
    setBalanceError('')
    setTransactionsError('')
    await Promise.all([
      getPointsBalance()
        .then(summary => setPointsBalance(summary.balance))
        .catch(err => setBalanceError(err instanceof Error ? err.message : 'server_error')),
      getPointTransactions()
        .then(summary => setPointTransactions(summary.recentTransactions))
        .catch(err => setTransactionsError(err instanceof Error ? err.message : 'server_error')),
    ])
  }

  if (!auth?.user) {
    return (
      <div className="account-points-page">
        <section className="section account-summary account-management account-management-empty">
          <div className="account-management-row">
            <div>
              <div className="account-management-label">Not signed in</div>
              <p className="account-management-copy">
                {pendingTripId ? 'Sign in to continue starting this trip.' : 'Sign in to start trips and receive booking updates.'}
              </p>
            </div>
            <Button onClick={onSignIn}>Sign in</Button>
          </div>
        </section>
        <LockedPointsSection onSignIn={onSignIn} />
      </div>
    )
  }

  return (
    <div className="account-points-page">
      <section className="section account-summary account-management">
        <div className="account-management-row">
          <div>
            <div className="account-management-label">Signed in as</div>
            <div className="account-email">{auth.user.email}</div>
            {auth.user.role && auth.user.role !== 'user' ? <div className="hint">Role: {auth.user.role}</div> : null}
          </div>
          <LoadingButton variant="secondary" onClick={logOut} loading={loading === 'signout'} loadingText="Signing out...">
            Sign out
          </LoadingButton>
        </div>
      </section>
      <PointsSection
        balance={pointsBalance}
        balanceError={balanceError}
        transactions={pointTransactions}
        transactionsError={transactionsError}
        onRedeemed={refreshPointData}
      />
    </div>
  )
}

function LockedPointsSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="account-points-card account-points-card-locked">
      <div className="account-section-icon"><Lock size={24} /></div>
      <div className="account-points-card-copy">
        <div className="account-card-kicker">Campsoon Points</div>
        <h2>Sign in to redeem points</h2>
        <p>Use a recharge code to add points. Points are charged only after a campsite is successfully paid.</p>
      </div>
      <Button className="account-points-sign-in" onClick={onSignIn}>Sign in first</Button>
    </section>
  )
}

function PointsStatusCard({
  icon,
  kicker,
  title,
  copy,
  warning,
}: {
  icon: ReactNode
  kicker: string
  title: string
  copy: string
  warning?: boolean
}) {
  return (
    <section className="account-points-card account-points-card-locked">
      <div className={`account-section-icon ${warning ? 'account-section-icon-warning' : ''}`}>{icon}</div>
      <div className="account-points-card-copy">
        <div className="account-card-kicker">{kicker}</div>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
    </section>
  )
}

function PointsSection({
  balance,
  balanceError,
  transactions,
  transactionsError,
  onRedeemed,
}: {
  balance: number | null
  balanceError: string
  transactions: PointTransaction[] | null
  transactionsError: string
  onRedeemed: () => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')
  const [success, setSuccess] = useState('')
  const [localBalance, setLocalBalance] = useState<number | null>(null)
  const shownBalance = localBalance ?? balance

  async function redeem(event: FormEvent) {
    event.preventDefault()
    setRedeeming(true)
    setRedeemError('')
    setSuccess('')
    try {
      const result = await redeemRechargeCode(code)
      setLocalBalance(result.balanceAfter)
      setCode('')
      setSuccess(`Added ${result.pointsGranted.toLocaleString()} points.`)
      await onRedeemed()
    } catch (err) {
      setRedeemError(redeemCodeMessage(err instanceof Error ? err.message : 'server_error'))
    } finally {
      setRedeeming(false)
    }
  }

  if (balanceError && transactionsError) {
    return (
      <PointsStatusCard
        icon={<CircleAlert size={24} />}
        kicker="Campsoon Points"
        title="Could not load points"
        copy={balanceError}
        warning
      />
    )
  }

  return (
    <>
      <section className="account-points-card account-buy-points">
        <div className="buy-points-header">
          <div className="buy-points-title-group">
            <h2>Redeem code</h2>
            <p>Enter the recharge code you received after offline payment.</p>
          </div>
          <div className={`points-balance-badge ${balanceError ? 'points-balance-badge-error' : ''}`} aria-label="Current points balance">
            {balanceError ? 'Points unavailable' : shownBalance === null ? 'Loading points' : `${shownBalance.toLocaleString()} points available`}
          </div>
        </div>
        <form className="recharge-code-form" onSubmit={redeem}>
          <div className="field recharge-code-field">
            <Label htmlFor="recharge-code">Recharge code</Label>
            <Input
              id="recharge-code"
              value={code}
              onChange={event => setCode(formatRechargeInput(event.target.value))}
              placeholder="CS-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <LoadingButton className="recharge-code-button" type="submit" loading={redeeming} loadingText="Redeeming..." disabled={!code.trim()}>
            <Gift size={16} />
            Redeem
          </LoadingButton>
        </form>
        {success ? <div className="account-redeem-message success">{success}</div> : null}
        {redeemError ? <div className="account-redeem-message error">{redeemError}</div> : null}
        <div className="account-stripe-note"><Mail size={15} /> <strong>Offline recharge enabled.</strong> Codes are issued by Campsoon after offline purchase.</div>
      </section>
      <section className="account-points-card account-point-activity">
        <div className="account-card-heading">
          <div>
            <h2>Point activity</h2>
            <p>A statement of every points purchase, deduction, and balance change.</p>
          </div>
        </div>
          {transactions ? transactions.length ? (
            <div className="point-activity-statement" role="table" aria-label="Point activity statement">
              <div className="point-activity-row point-activity-header" role="row">
                <div role="columnheader">Activity Type</div>
                <div role="columnheader">Points</div>
                <div role="columnheader">Points After</div>
                <div role="columnheader">Date</div>
                <div role="columnheader">Details</div>
              </div>
              {[...transactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(tx => (
                <div className="point-activity-row" key={tx.id}>
                  <div role="cell" data-label="Activity Type">{transactionLabel(tx.type)}</div>
                  <div role="cell" data-label="Points" className={tx.pointsDelta >= 0 ? 'point-activity-earned' : 'point-activity-spent'}>{tx.pointsDelta > 0 ? '+' : ''}{tx.pointsDelta.toLocaleString()}</div>
                  <div role="cell" data-label="Points After">{tx.balanceAfter.toLocaleString()}</div>
                  <div role="cell" data-label="Date">{formatTransactionDateTime(tx.createdAt)}</div>
                  <div role="cell" data-label="Details">{transactionDetails(tx)}</div>
                </div>
              ))}
            </div>
          ) : <div className="account-empty-state">No point activity yet.</div> : transactionsError ? (
            <div className="account-empty-state">Could not load point activity: {transactionsError}</div>
          ) : (
            <PointActivitySkeleton />
          )}
      </section>
    </>
  )
}

function PointActivitySkeleton() {
  return (
    <div className="point-activity-statement" aria-busy="true" aria-live="polite" aria-label="Loading point activity">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="point-activity-row" key={index}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-14 justify-self-end" />
          <Skeleton className="h-4 w-16 justify-self-end" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
}

function formatRechargeInput(value: string): string {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18)
  const groups = [raw.slice(0, 2), raw.slice(2, 6), raw.slice(6, 10), raw.slice(10, 14), raw.slice(14, 18)].filter(Boolean)
  return groups.join('-')
}

function redeemCodeMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_code: 'Enter a valid recharge code.',
    code_not_active: 'This recharge code is no longer active.',
    code_expired: 'This recharge code has expired.',
    email_mismatch: 'This recharge code is not assigned to this account.',
    code_fully_redeemed: 'This recharge code has already been used.',
    already_redeemed: 'This recharge code has already been redeemed.',
    server_error: 'Could not redeem this code. Try again in a moment.',
  }
  return map[code] ?? 'Could not redeem this code. Try again in a moment.'
}

function transactionLabel(type: string): string {
  return type.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function transactionDetails(tx: PointTransaction): string {
  if (tx.details?.trim()) return tx.details.trim()
  if (tx.type === 'booking_charge') return 'Successful booking deduction'
  if (tx.type === 'stripe_purchase') return 'Point package purchase'
  if (tx.type === 'stripe_refund') return 'Point package refund'
  if (tx.type === 'recharge_code') return 'Recharge code redemption'
  return 'Account activity'
}

function formatTransactionDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recent'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
