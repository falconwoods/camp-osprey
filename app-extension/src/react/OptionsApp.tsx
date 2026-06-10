import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  FileText,
  LockKeyhole,
  Plus,
  Settings,
  TentTree,
  TreePine,
  UserCircle,
  X,
} from 'lucide-react'
import { AccountPanel, SignInPanel } from './AuthPanel'
import { useExtensionState } from './chromeState'
import { TripCard } from './TripCard'
import { TripEditor } from './TripEditor'
import { PaymentPanel } from './PaymentPanel'
import { SettingsPanel } from './SettingsPanel'
import { isValidParkPayment, pauseTrip, removeTrip, startTripNow } from './tripActions'
import { getPointsSummary, type PointsSummary } from '../serverApi'
import { getGlobalWarnings, type Warning } from '../warnings'
import { IS_LOCAL_BUILD } from '../config'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { AppAlert } from '../components/AppAlert'
import type { ExtensionRemoteConfig, Trip } from '../types'
import { ExtensionUpdateAlert } from './ExtensionUpdateAlert'

type Tab = 'trips' | 'account' | 'payment' | 'settings' | 'logs'
const LocalLogsPanel = IS_LOCAL_BUILD
  ? lazy(() => import('./LogsPanel').then(module => ({ default: module.LogsPanel })))
  : null

function tabFromHash(): Tab {
  const hash = location.hash.replace('#', '')
  if (hash === 'account') return 'account'
  if (hash === 'payment') return 'payment'
  if (hash === 'settings') return 'settings'
  if (IS_LOCAL_BUILD && hash === 'logs') return 'logs'
  return 'trips'
}

export function OptionsApp() {
  const [tab, setTab] = useState<Tab>(() => location.hash.replace('#', '') === 'auth' ? 'account' : tabFromHash())
  const state = useExtensionState({ syncTripsOnLoad: tab === 'trips' })
  const [editing, setEditing] = useState<Trip | null | undefined>(undefined)
  const [authDialogOpen, setAuthDialogOpen] = useState(() => location.hash.replace('#', '') === 'auth')
  const [points, setPoints] = useState<PointsSummary | null>(null)
  const [pointsLoading, setPointsLoading] = useState(false)
  const [pointsError, setPointsError] = useState('')
  const userKey = state.auth?.user ? state.auth.user.id || state.auth.user.email : null

  useEffect(() => {
    const onHash = () => {
      if (location.hash.replace('#', '') === 'auth') {
        setAuthDialogOpen(true)
        if (tab === 'trips') setTab('account')
        return
      }
      setTab(tabFromHash())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [tab])

  useEffect(() => {
    if (tab === 'trips' && !state.loading && !state.tripsLoaded) {
      void state.refresh({ syncTrips: true, includeTrips: true })
    }
  }, [state.loading, state.refresh, state.tripsLoaded, tab])

  useEffect(() => {
    if (tab !== 'trips' || !userKey) {
      setPoints(null)
      setPointsLoading(false)
      setPointsError('')
      return
    }
    let cancelled = false
    setPointsLoading(true)
    setPointsError('')
    void getPointsSummary()
      .then(summary => {
        if (cancelled) return
        setPoints(summary)
      })
      .catch(err => {
        if (cancelled) return
        setPointsError(err instanceof Error ? err.message : 'server_error')
      })
      .finally(() => {
        if (!cancelled) setPointsLoading(false)
      })
    return () => { cancelled = true }
  }, [tab, userKey])

  function navigate(next: Tab) {
    if (editing !== undefined) setEditing(undefined)
    location.hash = next === 'trips' ? '' : next
    setTab(next)
  }

  function openAuthDialog() {
    setAuthDialogOpen(true)
    history.replaceState(null, '', '#auth')
  }

  function closeAuthDialog() {
    setAuthDialogOpen(false)
    if (location.hash.replace('#', '') === 'auth') {
      history.replaceState(null, '', tab === 'trips' ? location.pathname : `#${tab}`)
    }
  }

  async function handleStart(trip: Trip) {
    const result = await startTripNow(trip.id, false)
    if (!result.ok && result.reason === 'server_auth') {
      openAuthDialog()
    }
    if (!result.ok && result.reason === 'payment') navigate('payment')
    await state.refresh()
  }

  function handleNewTrip() {
    setEditing(null)
  }

  const paymentValid = useMemo(() => isValidParkPayment(state.storage?.payment ?? null), [state.storage?.payment])

  if (state.loading || !state.storage) return <PageLoadingShell tab={tab} />
  if (editing === undefined && tab === 'trips' && !state.tripsLoaded) return <PageLoadingShell tab={tab} />

  return (
    <div className="options-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <img src="/icons/icon128.png" alt="" />
          <div><strong>Campsoon</strong><span>Save Time Booking</span></div>
        </div>
        <nav className="nav-list">
          <NavButton active={tab === 'trips'} onClick={() => navigate('trips')} icon={<TentTree size={17} />} label="Trips" />
          <NavButton active={tab === 'account'} onClick={() => navigate('account')} icon={<UserCircle size={17} />} label="Account" />
          <NavButton active={tab === 'payment'} onClick={() => navigate('payment')} icon={<CreditCard size={17} />} label="Park Payment" />
          <NavButton active={tab === 'settings'} onClick={() => navigate('settings')} icon={<Settings size={17} />} label="Settings" />
          {IS_LOCAL_BUILD ? <NavButton active={tab === 'logs'} onClick={() => navigate('logs')} icon={<FileText size={17} />} label="Logs" /> : null}
        </nav>
        <div className="sidebar-account">
          <div className="sidebar-account-icon"><UserCircle size={25} /></div>
          <div><strong>{state.auth?.user ? state.auth.user.email : 'Not signed in'}</strong><span>{state.auth?.user ? 'Campsoon account' : 'Sign in to get started'}</span></div>
        </div>
      </aside>
      <main className={`options-main ${editing === undefined && tab === 'trips' ? 'options-main-trips' : ''}`}>
        {editing === undefined ? (
          <header className="page-header">
            <div>
              <h1>{tabTitle(tab)}</h1>
            </div>
            {tab === 'trips' ? (
              <div className="trips-header-actions">
                <div className={`credits-summary-pill ${pointsError ? 'credits-summary-unavailable' : ''}`} aria-label="Current points balance">
                  <span className="credits-summary-value">
                    {pointsLoading ? 'Loading points' : points ? `${points.balance.toLocaleString()} points` : 'Points unavailable'}
                  </span>
                  <button type="button" className="credits-summary-topup" onClick={() => navigate('account')}>Top up</button>
                </div>
                <Button onClick={handleNewTrip}><Plus size={16} /> New Trip</Button>
              </div>
            ) : null}
          </header>
        ) : null}
        {editing !== undefined ? (
          <TripEditor
            trip={editing}
            tripCount={state.trips.length}
            paymentValid={paymentValid}
            onClose={() => setEditing(undefined)}
            onSaved={state.refresh}
            onDelete={async trip => {
              if (!confirm(`Delete "${trip.name}"?`)) return
              await removeTrip(trip)
              await state.refresh()
              setEditing(undefined)
            }}
            onNeedsAuth={openAuthDialog}
            onNeedsPayment={() => { setEditing(undefined); navigate('payment') }}
          />
        ) : tab === 'trips' ? (
          <TripsView
            trips={state.trips}
            signedIn={Boolean(state.auth?.user)}
            bcParksLoggedIn={state.bcParksLoggedIn}
            extensionConfig={state.storage.extensionConfig}
            warnings={getGlobalWarnings(state.trips, state.bcParksLoggedIn, state.storage.payment)}
            onSignIn={openAuthDialog}
            onEdit={trip => setEditing(trip)}
            onStart={handleStart}
            onPause={async trip => { await pauseTrip(trip.id); await state.refresh() }}
            onDelete={async trip => {
              if (!confirm(`Delete "${trip.name}"?`)) return
              await removeTrip(trip)
              await state.refresh()
            }}
            onWarningRoute={route => navigate(route)}
          />
        ) : null}
        {tab === 'account' ? <AccountPanel auth={state.auth} onChanged={() => state.refresh({ includeTrips: false })} onSignIn={openAuthDialog} /> : null}
        {tab === 'payment' ? <PaymentPanel auth={state.auth} payment={state.storage.payment} onChanged={() => state.refresh({ includeTrips: false })} onSignIn={openAuthDialog} /> : null}
        {tab === 'settings' ? <SettingsPanel settings={state.storage.settings} extensionConfig={state.storage.extensionConfig} onChanged={() => state.refresh({ includeTrips: false })} /> : null}
        {IS_LOCAL_BUILD && tab === 'logs' && LocalLogsPanel ? (
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <LocalLogsPanel logs={state.debugLog} onChanged={() => state.refresh({ includeTrips: false })} />
          </Suspense>
        ) : null}
      </main>
      {authDialogOpen ? (
        <div className="auth-modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) closeAuthDialog()
        }}>
          <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
            <button className="auth-modal-close" type="button" aria-label="Close sign in dialog" onClick={closeAuthDialog}>
              <X size={18} />
            </button>
            <SignInPanel
              auth={state.auth}
              titleId="auth-modal-title"
              onChanged={async () => {
                closeAuthDialog()
                await state.refresh()
              }}
              onTripReady={async id => {
                closeAuthDialog()
                await handleStart({ id } as Trip)
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PageLoadingShell({ tab }: { tab: Tab }) {
  const title = tabTitle(tab)
  const isTrips = tab === 'trips'

  return (
    <div className="options-shell">
      <aside className="sidebar" aria-hidden="true">
        <div className="brand-row">
          <img src="/icons/icon128.png" alt="" />
          <div><strong>Campsoon</strong><span>Save Time Booking</span></div>
        </div>
        <div className="nav-list trips-loading-nav">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton className={`h-10 ${index === 0 ? 'w-full' : 'w-4/5'}`} key={index} />
          ))}
        </div>
        <div className="sidebar-account">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </aside>
      <main className={`options-main ${isTrips ? 'options-main-trips' : ''}`}>
        <header className="page-header">
          <div>
            <h1>{title}</h1>
          </div>
          {isTrips ? <Skeleton className="h-10 w-28 rounded-md" /> : null}
        </header>
        <section className={isTrips ? 'trips-dashboard trip-list-loading' : 'section'} aria-busy="true" aria-live="polite" aria-label={`Loading ${title.toLowerCase()}`}>
          <div className="account-loading-status" role="status">
            <span className="account-loading-spinner" aria-hidden="true" />
            <span>Loading {title.toLowerCase()}...</span>
          </div>
          {isTrips ? Array.from({ length: 3 }, (_, index) => (
            <div className="ui-card trip-card trip-card-skeleton" key={index}>
              <div className="trip-card-main">
                <div className="trip-summary">
                  <Skeleton className="h-5 w-44 max-w-full" />
                  <div className="trip-meta-row">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="trip-meta-row">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
                <div className="trip-mode-slot">
                  <Skeleton className="h-9 w-32 rounded-md" />
                </div>
                <div className="trip-status-panel">
                  <div className="trip-status-copy">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="mt-3 h-4 w-52 max-w-full" />
                    <Skeleton className="mt-3 h-4 w-40 max-w-full" />
                  </div>
                  <div className="trip-actions-row">
                    <Skeleton className="h-10 w-20 rounded-md" />
                    <Skeleton className="h-10 w-10 rounded-md" />
                    <Skeleton className="h-10 w-10 rounded-md" />
                  </div>
                </div>
              </div>
            </div>
          )) : null}
        </section>
      </main>
    </div>
  )
}

function TripsView({
  trips,
  signedIn,
  bcParksLoggedIn,
  extensionConfig,
  warnings,
  onSignIn,
  onEdit,
  onStart,
  onPause,
  onDelete,
  onWarningRoute,
}: {
  trips: Trip[]
  signedIn: boolean
  bcParksLoggedIn: boolean
  extensionConfig: ExtensionRemoteConfig | null
  warnings: Warning[]
  onSignIn: () => void
  onEdit: (trip: Trip) => void
  onStart: (trip: Trip) => void
  onPause: (trip: Trip) => void
  onDelete: (trip: Trip) => void
  onWarningRoute: (route: Tab) => void
}) {
  const connectBcParks = () => chrome.tabs.create({ url: 'https://camping.bcparks.ca/login' })
  const needsTwoStepOnboarding = !signedIn && !bcParksLoggedIn
  const needsCampsoonReconnect = !signedIn && bcParksLoggedIn
  const needsBcParksReconnect = signedIn && !bcParksLoggedIn
  const visibleWarnings = warnings.filter(warning => warning.title !== 'BC Parks sign-in needed')

  return (
    <div className="trips-dashboard">
      <ExtensionUpdateAlert config={extensionConfig} />
      {needsCampsoonReconnect ? (
        <AppAlert
          variant="error"
          title="Campsoon session expired"
          message="Sign in again to continue."
          action={{ label: 'Sign in', onClick: onSignIn }}
        />
      ) : null}
      {needsBcParksReconnect ? (
        <AppAlert
          variant="error"
          title="BC Parks sign-in needed"
          message="Sign in to BC Parks to continue using auto-reserve and auto-pay."
          action={{ label: 'Open BC Parks', onClick: connectBcParks }}
        />
      ) : null}
      {signedIn && bcParksLoggedIn ? (
        <div className="connection-grid setup-complete-grid">
          <section className="connection-card">
            <div className="connection-icon"><UserCircle size={34} /></div>
            <div className="connection-copy">
              <h2>Campsoon account</h2>
              <p><span className="mini-dot online" /> Signed in</p>
            </div>
          </section>
          <section className="connection-card">
            <div className="connection-icon"><TreePine size={32} /></div>
            <div className="connection-copy">
              <h2>BC Parks</h2>
              <p><span className="mini-dot online" /> Signed in</p>
            </div>
          </section>
        </div>
      ) : null}
      {needsTwoStepOnboarding ? (
        <>
          <section className="onboarding-panel">
            <div className="onboarding-image-slot" aria-hidden="true" />
            <div className="onboarding-content">
              <h2>Get started in 2 steps</h2>
              <div className="step-row">
                <div className="step-item">
                  <div className="connection-icon"><UserCircle size={31} /></div>
                  <div>
                    <strong>Step 1</strong>
                    <h3>Sign in to your Campsoon account</h3>
                    <p>Required to manage trips, receive alerts, and control automation.</p>
                  </div>
                </div>
                <ChevronRight className="step-arrow" size={48} aria-hidden="true" />
                <div className="step-item">
                  <div className="connection-icon"><TreePine size={31} /></div>
                  <div>
                    <strong>Step 2</strong>
                    <h3>Sign in to BC Parks</h3>
                    <p>Required for Auto-reserve and Auto-pay to make bookings and payments.</p>
                  </div>
                </div>
              </div>
              <p className="onboarding-note">Both steps are required to unlock all features and automate your campground bookings.</p>
              <Button onClick={onSignIn}>
                <LockKeyhole size={16} />
                Sign in to Campsoon
              </Button>
            </div>
          </section>
          <FeatureOverview />
        </>
      ) : null}
      {visibleWarnings.map((warning, index) => (
        <AppAlert
          key={index}
          variant={warning.level === 'error' ? 'error' : 'warning'}
          title={warning.title ?? 'Heads up'}
          message={warning.message}
          action={warning.action ? {
            label: warning.action.label,
            onClick: () => warning.action?.url === '#payment'
              ? onWarningRoute('payment')
              : chrome.tabs.create({ url: warning.action!.url }),
          } : undefined}
        />
      ))}
      {trips.length ? trips.map(trip => (
        <TripCard key={trip.id} trip={trip} onEdit={onEdit} onStart={onStart} onPause={onPause} onDelete={onDelete} />
      )) : signedIn ? (
        <section className="empty-state trips-empty-state">
          <FeatureOverview />
          <div className="empty-illustration" aria-hidden="true" />
          <h2>No trips yet</h2>
        </section>
      ) : null}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}{label}</button>
}

function FeatureTile({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="feature-tile">
      <div className="feature-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  )
}

function FeatureOverview() {
  return (
    <div className="feature-grid">
      <FeatureTile icon={<Plus size={19} />} title="Create trips" description="Set up trips and monitor site availability." />
      <FeatureTile icon={<Bell size={20} />} title="Get alerts" description="Receive notifications when sites open up." />
      <FeatureTile icon={<CalendarCheck size={20} />} title="Auto-reserve" description="Automatically book sites when available." />
      <FeatureTile icon={<CreditCard size={20} />} title="Auto-pay" description="Securely pay reservation fees automatically." />
    </div>
  )
}

function tabTitle(tab: Tab): string {
  return {
    trips: 'Trips',
    account: 'Account',
    payment: 'Park Payment',
    settings: 'Settings',
    logs: 'Logs',
  }[tab]
}
