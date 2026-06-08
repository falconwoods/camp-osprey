import { useEffect, useMemo, useState } from 'react'
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
import { LogsPanel } from './LogsPanel'
import { isValidParkPayment, pauseTrip, removeTrip, startTripNow } from './tripActions'
import { getGlobalWarnings, type Warning } from '../warnings'
import { Button } from '../components/ui/button'
import { AppAlert } from '../components/AppAlert'
import type { Trip } from '../types'

type Tab = 'trips' | 'account' | 'payment' | 'settings' | 'logs'

function tabFromHash(): Tab {
  const hash = location.hash.replace('#', '')
  if (hash === 'account') return 'account'
  if (hash === 'payment') return 'payment'
  if (hash === 'settings') return 'settings'
  if (hash === 'logs') return 'logs'
  return 'trips'
}

export function OptionsApp() {
  const state = useExtensionState()
  const [tab, setTab] = useState<Tab>(() => location.hash.replace('#', '') === 'auth' ? 'account' : tabFromHash())
  const [editing, setEditing] = useState<Trip | null | undefined>(undefined)
  const [authDialogOpen, setAuthDialogOpen] = useState(() => location.hash.replace('#', '') === 'auth')

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

  function navigate(next: Tab) {
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

  if (state.loading || !state.storage) return <div className="options-shell loading-view">Loading campsoon...</div>

  return (
    <div className="options-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <img src="/icons/icon48.png" alt="" />
          <div><strong>Campsoon</strong><span>Extension</span></div>
        </div>
        <nav className="nav-list">
          <NavButton active={tab === 'trips'} onClick={() => navigate('trips')} icon={<TentTree size={17} />} label="Trips" />
          <NavButton active={tab === 'account'} onClick={() => navigate('account')} icon={<UserCircle size={17} />} label="Account" />
          <NavButton active={tab === 'payment'} onClick={() => navigate('payment')} icon={<CreditCard size={17} />} label="Park Payment" />
          <NavButton active={tab === 'settings'} onClick={() => navigate('settings')} icon={<Settings size={17} />} label="Settings" />
          {state.storage.settings.debugMode ? <NavButton active={tab === 'logs'} onClick={() => navigate('logs')} icon={<FileText size={17} />} label="Logs" /> : null}
        </nav>
        <div className="sidebar-account">
          <div className="sidebar-account-icon"><UserCircle size={25} /></div>
          <div><strong>{state.auth?.user ? state.auth.user.email : 'Not signed in'}</strong><span>{state.auth?.user ? 'Campsoon account' : 'Sign in to get started'}</span></div>
        </div>
      </aside>
      <main className="options-main">
        <header className="page-header">
          <div>
            <h1>{editing !== undefined ? (editing ? 'Edit Trip' : 'New Trip') : tabTitle(tab)}</h1>
          </div>
          {editing === undefined && tab === 'trips' ? <Button onClick={handleNewTrip}><Plus size={16} /> New Trip</Button> : null}
        </header>
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
        {tab === 'account' ? <AccountPanel auth={state.auth} onChanged={state.refresh} onSignIn={openAuthDialog} /> : null}
        {tab === 'payment' ? <PaymentPanel auth={state.auth} payment={state.storage.payment} onChanged={state.refresh} onSignIn={openAuthDialog} /> : null}
        {tab === 'settings' ? <SettingsPanel settings={state.storage.settings} onChanged={state.refresh} /> : null}
        {tab === 'logs' ? <LogsPanel logs={state.debugLog} onChanged={state.refresh} /> : null}
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

function TripsView({
  trips,
  signedIn,
  bcParksLoggedIn,
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
          title="BC Parks connection needed"
          message="Connect your BC Parks account to continue."
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
              <p><span className="mini-dot online" /> Connected</p>
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
                    <h3>Connect your BC Parks account</h3>
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
