import { getAuth, getPendingStartTripId, getStorage } from '../storage'
import { applyTheme } from '../theme'
import { watchLoginChanges } from '../background/login'
import { renderAuthPanelHTML, bindAccountPanel } from '../accountPanel'
import { clearPendingStartTripId, consumePendingStartTripId } from '../startAuthGate'
import { AccountPage } from './Account/accountPage'
import { LogsPage } from './settings/logsPage'
import { ParkPaymentPage } from './settings/parkPaymentPage'
import { SettingsPage } from './settings/settingsPage'
import { HeaderAccount } from './navbar/headerAccount'
import { OptionsNavbar } from './navbar/optionsNavbar'
import { TripsPage } from './trips/tripsPage'

// Apply saved theme before anything renders
getStorage().then(({ settings }) => applyTheme(settings.theme ?? 'auto'))

let authDialogOpen = false

const navbar = new OptionsNavbar({
  openAuthDialog,
  refreshDebugLog,
  renderAccount,
  renderPayment,
})
const headerAccount = new HeaderAccount({
  openAuthDialog,
  showAccountTab: () => navbar.showAccountTab(),
})
const tripsPage = new TripsPage({
  openAuthDialog,
  renderHeaderAccount,
})
const accountPage = new AccountPage({
  openAuthDialog,
  renderHeaderAccount,
  renderTripList,
  startTripNow,
})
const logsPage = new LogsPage()
const paymentPage = new ParkPaymentPage({ openAuthDialog, renderTripList })
const settingsPage = new SettingsPage({ onDebugModeChange: enabled => navbar.updateLogsTabVisibility(enabled) })

// ── Page coordination ──────────────────────────────────────────────────────

async function renderHeaderAccount(): Promise<void> {
  await headerAccount.render()
}

async function renderAccount(): Promise<void> {
  await accountPage.render()
}

async function renderPayment(): Promise<void> {
  await paymentPage.render()
}

async function refreshDebugLog(): Promise<void> {
  await logsPage.refresh()
}

function scheduleDebugLogRefresh(): void {
  logsPage.scheduleRefresh()
}

function authDialogRoot(): HTMLElement {
  let root = document.getElementById('auth-dialog-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'auth-dialog-root'
    document.body.appendChild(root)
  }
  return root
}

function closeAuthDialog(): void {
  authDialogOpen = false
  document.body.classList.remove('auth-dialog-open')
  authDialogRoot().innerHTML = ''
}

async function openAuthDialog(): Promise<void> {
  const root = authDialogRoot()
  const auth = await getAuth()
  if (auth.user) {
    closeAuthDialog()
    await navbar.showAccountTab()
    return
  }
  const pendingTripId = await getPendingStartTripId()
  authDialogOpen = true
  document.body.classList.add('auth-dialog-open')
  root.innerHTML = `<div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
    <button class="auth-dialog-close" id="auth-dialog-close" type="button" aria-label="Close sign in dialog">×</button>
    ${renderAuthPanelHTML(auth, pendingTripId)}
  </div>`
  const title = document.querySelector<HTMLElement>('#auth-dialog-root .auth-title')
  if (title) title.id = 'auth-dialog-title'
  document.getElementById('auth-dialog-close')?.addEventListener('click', async () => {
    await clearPendingStartTripId()
    closeAuthDialog()
    await renderAccount()
  })
  bindAccountPanel(async () => {
    closeAuthDialog()
    const tripId = await consumePendingStartTripId()
    if (tripId) await startTripNow(tripId)
    await renderAccount()
    await renderHeaderAccount()
    await renderTripList()
    if (navbar.activeTab === 'payment') await renderPayment()
  }, async () => {
    await renderAccount()
    await renderHeaderAccount()
  })
  ;(document.getElementById('auth-email') as HTMLInputElement | null)?.focus()
}

async function renderTripList(): Promise<void> {
  await tripsPage.renderList()
}

async function startTripNow(id: string): Promise<boolean> {
  return tripsPage.startTripNow(id)
}

// Auto-refresh global alerts when BC Parks login state changes
watchLoginChanges(() => {
  if (navbar.activeTab === 'trips') void renderTripList()
})

// Live refresh when service worker updates storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if ('payment' in changes || (navbar.activeTab === 'trips' && 'auth' in changes)) void renderTripList()
    if (navbar.activeTab === 'account' && 'auth' in changes) void renderAccount()
    if (navbar.activeTab === 'logs' && 'debugLog' in changes) scheduleDebugLogRefresh()
  }
})

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg.type === 'TRIPS_CHANGED' && navbar.activeTab === 'trips') void renderTripList()
})

async function loadSettingsForm(): Promise<void> {
  await settingsPage.loadForm()
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  navbar.bind()
  tripsPage.bind()
  settingsPage.bind()
  logsPage.bind()
  await loadSettingsForm()
  await navbar.routeFromHash()
  await renderTripList()
}

void init()
