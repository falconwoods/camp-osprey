export type OptionsTab = 'trips' | 'settings' | 'account' | 'payment' | 'logs'

const OPTIONS_TABS: OptionsTab[] = ['trips', 'settings', 'account', 'payment', 'logs']

type OptionsNavbarCallbacks = {
  openAuthDialog: () => Promise<void>
  refreshDebugLog: () => Promise<void>
  renderAccount: () => Promise<void>
  renderPayment: () => Promise<void>
}

export class OptionsNavbar {
  private debugModeEnabled = false
  activeTab: OptionsTab = this.tabFromHash()

  constructor(private readonly callbacks: OptionsNavbarCallbacks) {}

  bind(): void {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const name = (tab as HTMLElement).dataset['tab'] as OptionsTab
        if (name === 'logs' && !this.debugModeEnabled) return
        if (name === 'account') {
          void this.showAccountTab()
          return
        }
        if (name === 'payment') {
          void this.showPaymentTab()
          return
        }
        location.hash = name
        this.selectTab(name)
      })
    })

    window.addEventListener('hashchange', () => {
      void this.routeFromHash()
    })
  }

  selectTab(name: OptionsTab): void {
    if (name === 'logs' && !this.debugModeEnabled) name = 'trips'
    this.activeTab = name
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset['tab'] === name)
    })
    document.getElementById('tab-trips')!.classList.toggle('hidden', name !== 'trips')
    document.getElementById('tab-settings')!.classList.toggle('hidden', !['settings', 'payment', 'logs'].includes(name))
    document.getElementById('tab-settings-general')!.classList.toggle('hidden', name !== 'settings')
    document.getElementById('tab-account')!.classList.toggle('hidden', name !== 'account')
    document.getElementById('tab-payment')!.classList.toggle('hidden', name !== 'payment')
    document.getElementById('tab-logs')!.classList.toggle('hidden', name !== 'logs')
    if (name === 'logs') void this.callbacks.refreshDebugLog()
  }

  async showAccountTab(): Promise<void> {
    if (location.hash !== '#account') {
      history.pushState(null, '', '#account')
    }
    this.selectTab('account')
    await this.callbacks.renderAccount()
  }

  async showPaymentTab(): Promise<void> {
    if (location.hash !== '#payment') {
      history.pushState(null, '', '#payment')
    }
    this.selectTab('payment')
    await this.callbacks.renderPayment()
  }

  async routeFromHash(): Promise<void> {
    if (location.hash === '#auth') {
      this.selectTab('trips')
      await this.callbacks.openAuthDialog()
      return
    }
    const tab = this.tabFromHash()
    this.selectTab(tab)
    if (tab === 'account') await this.callbacks.renderAccount()
    if (tab === 'payment') await this.callbacks.renderPayment()
  }

  updateLogsTabVisibility(enabled: boolean): void {
    this.debugModeEnabled = enabled
    document.querySelectorAll<HTMLElement>('[data-tab="logs"]').forEach(tab => {
      tab.classList.toggle('hidden', !enabled)
    })
    if (!enabled && this.activeTab === 'logs') {
      location.hash = 'trips'
      this.selectTab('trips')
    }
  }

  private tabFromHash(): OptionsTab {
    const hashTab = location.hash.replace('#', '') as OptionsTab
    if (!OPTIONS_TABS.includes(hashTab)) return 'trips'
    if (hashTab === 'logs' && !this.debugModeEnabled) return 'trips'
    return hashTab
  }
}
