import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  FileText,
  FlaskConical,
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
import { getPointsBalance } from '../serverApi'
import { getGlobalWarnings, type Warning } from '../warnings'
import { IS_LOCAL_BUILD } from '../config'
import { getExtensionUpdateUrl } from '../extensionConfig'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { AppAlert } from '../components/AppAlert'
import { useConfirmDialog } from '../components/ConfirmDialog'
import type { ExtensionRemoteConfig, MatchedSite, Trip } from '../types'
import { ExtensionUpdateAlert, OptionalUpdateDetails, RequiredUpdateDetails } from './ExtensionUpdateAlert'

type Tab = 'trips' | 'account' | 'payment' | 'settings' | 'logs' | 'demo'
const LocalLogsPanel = IS_LOCAL_BUILD
  ? lazy(() => import('./LogsPanel').then(module => ({ default: module.LogsPanel })))
  : null

function tabFromHash(): Tab {
  const hash = location.hash.replace('#', '')
  if (hash === 'account') return 'account'
  if (hash === 'payment') return 'payment'
  if (hash === 'settings') return 'settings'
  if (IS_LOCAL_BUILD && hash === 'logs') return 'logs'
  if (IS_LOCAL_BUILD && hash === 'demo') return 'demo'
  return 'trips'
}

export function OptionsApp() {
  const initialHash = location.hash.replace('#', '')
  const [tab, setTab] = useState<Tab>(() => initialHash === 'auth' ? 'account' : tabFromHash())
  const state = useExtensionState({ syncTripsOnLoad: tab === 'trips' })
  const [editing, setEditing] = useState<Trip | null | undefined>(undefined)
  const [authDialogOpen, setAuthDialogOpen] = useState(() => initialHash === 'auth')
  const [updateDialogRequested, setUpdateDialogRequested] = useState(() => initialHash === 'update-required')
  const [pointsBalance, setPointsBalance] = useState<number | null>(null)
  const [pointsLoading, setPointsLoading] = useState(false)
  const [pointsError, setPointsError] = useState('')
  const confirmation = useConfirmDialog()
  const userKey = state.auth?.user ? state.auth.user.id || state.auth.user.email : null

  useEffect(() => {
    const onHash = () => {
      if (location.hash.replace('#', '') === 'auth') {
        setAuthDialogOpen(true)
        if (tab === 'trips') setTab('account')
        return
      }
      if (location.hash.replace('#', '') === 'update-required') {
        setUpdateDialogRequested(true)
        if (tab !== 'trips') setTab('trips')
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
      setPointsBalance(null)
      setPointsLoading(false)
      setPointsError('')
      return
    }
    let cancelled = false
    setPointsLoading(true)
    setPointsError('')
    void getPointsBalance()
      .then(summary => {
        if (cancelled) return
        setPointsBalance(summary.balance)
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

  useEffect(() => {
    if (!updateDialogRequested || state.loading || !state.storage) return
    setUpdateDialogRequested(false)
    void promptForExtensionUpdate()
  }, [state.loading, state.storage, updateDialogRequested])

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
    if (!result.ok && result.reason === 'extension_update_required') await promptForExtensionUpdate()
    if (!result.ok && result.reason === 'active_trip') await promptForActiveTrip()
    if (!result.ok && result.reason === 'payment') await promptForPaymentSetup()
    if (!result.ok && result.reason === 'points') await promptForPointsTopUp()
    await state.refresh()
  }

  async function promptForExtensionUpdate() {
    const config = state.storage?.extensionConfig ?? null
    const confirmed = await confirmation.confirm({
      title: 'Update required',
      message: <RequiredUpdateDetails config={config} />,
      confirmLabel: 'Download update',
      cancelLabel: 'Close',
    })
    if (confirmed) chrome.tabs.create({ url: getExtensionUpdateUrl(config) })
  }

  async function promptForOptionalExtensionUpdate() {
    const config = state.storage?.extensionConfig ?? null
    const confirmed = await confirmation.confirm({
      title: config?.releaseNote?.title ?? 'Update available',
      message: <OptionalUpdateDetails config={config} />,
      confirmLabel: 'Download update',
      cancelLabel: 'Close',
    })
    if (confirmed) chrome.tabs.create({ url: getExtensionUpdateUrl(config) })
  }

  async function promptForActiveTrip() {
    await confirmation.confirm({
      title: 'Only one active trip is allowed',
      message: 'Pause your current active trip before starting another one.',
      confirmLabel: 'OK',
      cancelLabel: null,
    })
  }

  async function promptForPointsTopUp() {
    const confirmed = await confirmation.confirm({
      title: 'Not enough points',
      message: (
        <>
          <p>Auto-reserve and Auto-pay require enough points for one successful booking before scanning can start.</p>
          <p>Top up your account to start this trip.</p>
        </>
      ),
      confirmLabel: 'Top up points',
    })
    if (confirmed) {
      setEditing(undefined)
      navigate('account')
    }
  }

  async function promptForPaymentSetup() {
    const confirmed = await confirmation.confirm({
      title: 'Auto-pay requires Park Payment',
      message: 'Add your Park Payment details before starting an Auto-pay trip.',
      confirmLabel: 'Set up Park Payment',
    })
    if (confirmed) {
      setEditing(undefined)
      navigate('payment')
    }
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
          {IS_LOCAL_BUILD ? <NavButton active={tab === 'demo'} onClick={() => navigate('demo')} icon={<FlaskConical size={17} />} label="Demo" /> : null}
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
                    {pointsLoading ? 'Loading points' : pointsBalance !== null ? `${pointsBalance.toLocaleString()} points` : 'Points unavailable'}
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
              const confirmed = await confirmation.confirm({
                title: 'Delete trip?',
                message: `Delete "${trip.name}"? This cannot be undone.`,
                confirmLabel: 'Delete trip',
                variant: 'destructive',
              })
              if (!confirmed) return
              await removeTrip(trip)
              await state.refresh()
              setEditing(undefined)
            }}
            onNeedsAuth={openAuthDialog}
            onNeedsPayment={() => { setEditing(undefined); navigate('payment') }}
            onInvalidPayment={promptForPaymentSetup}
            onInsufficientPoints={promptForPointsTopUp}
            onActiveTripBlocked={promptForActiveTrip}
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
              const confirmed = await confirmation.confirm({
                title: 'Delete trip?',
                message: `Delete "${trip.name}"? This cannot be undone.`,
                confirmLabel: 'Delete trip',
                variant: 'destructive',
              })
              if (!confirmed) return
              await removeTrip(trip)
              await state.refresh()
            }}
            onWarningRoute={route => navigate(route)}
            onRequiredUpdate={promptForExtensionUpdate}
            onOptionalUpdate={promptForOptionalExtensionUpdate}
          />
        ) : null}
        {tab === 'account' ? <AccountPanel auth={state.auth} onChanged={() => state.refresh({ includeTrips: false })} onSignIn={openAuthDialog} /> : null}
        {tab === 'payment' ? <PaymentPanel auth={state.auth} payment={state.storage.payment} onChanged={() => state.refresh({ includeTrips: false })} onSignIn={openAuthDialog} /> : null}
        {tab === 'settings' ? <SettingsPanel settings={state.storage.settings} extensionConfig={state.storage.extensionConfig} onChanged={() => state.refresh({ includeTrips: false })} /> : null}
        {IS_LOCAL_BUILD && tab === 'demo' ? <DemoPanel /> : null}
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
      {confirmation.dialog}
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
  onRequiredUpdate,
  onOptionalUpdate,
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
  onRequiredUpdate: () => void
  onOptionalUpdate: () => void
}) {
  const connectBcParks = () => chrome.tabs.create({ url: 'https://camping.bcparks.ca/login' })
  const needsTwoStepOnboarding = !signedIn && !bcParksLoggedIn
  const needsCampsoonReconnect = !signedIn && bcParksLoggedIn
  const needsBcParksReconnect = signedIn && !bcParksLoggedIn
  const visibleWarnings = warnings.filter(warning => warning.title !== 'BC Parks sign-in needed')

  return (
    <div className="trips-dashboard">
      <ExtensionUpdateAlert
        config={extensionConfig}
        onRequiredUpdate={onRequiredUpdate}
        onOptionalUpdate={onOptionalUpdate}
      />
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

const DEMO_NOW = Date.UTC(2026, 5, 11, 17, 30, 0)

const demoTrips: Array<{ label: string; trip: Trip }> = [
  {
    label: 'Alert Only / monitoring',
    trip: makeDemoTrip({
      id: 'demo-alert-monitoring',
      name: 'Trip 1 - Alice Lake',
      mode: 'alert',
      status: 'scanning',
      updatedAt: DEMO_NOW - 1000 * 60 * 8,
    }),
  },
  {
    label: 'Alert Only / match found',
    trip: makeDemoTrip({
      id: 'demo-alert-found',
      name: 'Trip 2 - Alice Lake',
      mode: 'alert',
      status: 'scanning',
      lastMatch: makeDemoMatch({ foundAt: '2026-06-11T17:18:00.000Z', siteName: 'C14' }),
      updatedAt: DEMO_NOW - 1000 * 60 * 3,
    }),
  },
  {
    label: 'Auto-reserve / reserving',
    trip: makeDemoTrip({
      id: 'demo-reserve-working',
      name: 'Trip 3 - Alice Lake',
      mode: 'reserve',
      status: 'reserving',
      lastMatch: makeDemoMatch({ foundAt: '2026-06-11T17:24:00.000Z', siteName: 'B07' }),
      updatedAt: DEMO_NOW - 1000 * 60,
    }),
  },
  {
    label: 'Auto-reserve / booked',
    trip: makeDemoTrip({
      id: 'demo-reserve-success',
      name: 'Trip 4 - Alice Lake',
      mode: 'reserve',
      status: 'reserved',
      lastMatch: makeDemoMatch({
        foundAt: '2026-06-11T17:05:00.000Z',
        reservedAt: '2026-06-11T17:07:00.000Z',
        siteName: 'D21',
        sectionName: 'Lakeside',
      }),
      updatedAt: DEMO_NOW - 1000 * 60 * 20,
    }),
  },
  {
    label: 'Auto-pay / reservation captured',
    trip: makeDemoTrip({
      id: 'demo-autopay-reserved',
      name: 'Trip 5 - Alice Lake',
      mode: 'autopay',
      status: 'reserved',
      lastMatch: makeDemoMatch({
        foundAt: '2026-06-11T16:52:00.000Z',
        reservedAt: '2026-06-11T16:54:00.000Z',
        siteName: 'A09',
        sectionName: 'Forest Loop',
      }),
      updatedAt: DEMO_NOW - 1000 * 60 * 36,
    }),
  },
  {
    label: 'Auto-pay / paid',
    trip: makeDemoTrip({
      id: 'demo-autopay-paid',
      name: 'Trip 6 - Alice Lake',
      mode: 'autopay',
      status: 'paid',
      lastMatch: makeDemoMatch({
        foundAt: '2026-06-11T16:30:00.000Z',
        reservedAt: '2026-06-11T16:32:00.000Z',
        paidAt: '2026-06-11T16:33:00.000Z',
        siteName: 'F03',
        sectionName: 'Creekside',
      }),
      updatedAt: DEMO_NOW - 1000 * 60 * 57,
    }),
  },
  {
    label: 'Auto-pay / payment failed',
    trip: makeDemoTrip({
      id: 'demo-autopay-failed',
      name: 'Trip 7 - Alice Lake',
      mode: 'autopay',
      status: 'failed',
      lastMatch: makeDemoMatch({
        foundAt: '2026-06-11T15:58:00.000Z',
        reservedAt: '2026-06-11T16:00:00.000Z',
        siteName: 'H18',
        sectionName: 'North Loop',
      }),
      updatedAt: DEMO_NOW - 1000 * 60 * 90,
    }),
  },
]

function DemoPanel() {
  const noop = () => undefined

  return (
    <section className="demo-dashboard" aria-label="Trip card demo states">
      <div className="demo-grid">
        {demoTrips.map(({ label, trip }) => (
          <section className="demo-state" key={trip.id}>
            <div className="demo-state-label">{label}</div>
            <TripCard trip={trip} onStart={noop} onPause={noop} />
          </section>
        ))}
      </div>
    </section>
  )
}

function makeDemoTrip(overrides: Partial<Trip>): Trip {
  return {
    id: 'demo-trip',
    name: 'Demo trip',
    provider: 'bc_parks',
    parks: [
      { id: 'bc-1', name: 'Alice Lake Park' },
      { id: 'bc-2', name: 'Porteau Cove Park' },
    ],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-18', checkOut: '2026-07-21' }],
    filters: { noWalkin: true, noDouble: true },
    mode: 'alert',
    status: 'idle',
    lastMatch: null,
    attempted: [],
    createdAt: DEMO_NOW - 1000 * 60 * 60 * 24 * 5,
    updatedAt: DEMO_NOW - 1000 * 60 * 15,
    ...overrides,
  }
}

function makeDemoMatch(overrides: Partial<MatchedSite> = {}): MatchedSite {
  return {
    parkName: 'Alice Lake Park',
    siteName: 'C14',
    sectionName: 'Stump Lake',
    checkIn: '2026-07-18',
    checkOut: '2026-07-21',
    bookingUrl: 'https://camping.bcparks.ca/create-booking/results?demo=campsoon',
    resourceId: 'demo-resource',
    availableCount: 1,
    ...overrides,
  }
}

function tabTitle(tab: Tab): string {
  return {
    trips: 'Trips',
    account: 'Account',
    payment: 'Park Payment',
    settings: 'Settings',
    logs: 'Logs',
    demo: 'Demo',
  }[tab]
}
