import { saveSettings, getStorage } from '../../storage'
import { applyTheme } from '../../theme'
import type { LogLevel, Settings, Theme } from '../../types'

type SettingsPageOptions = {
  onDebugModeChange: (enabled: boolean) => void
}

export class SettingsPage {
  private selectedTheme: Theme = 'auto'

  constructor(private readonly options: SettingsPageOptions) {}

  bind(): void {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.selectedTheme = (btn as HTMLElement).dataset['themeChoice'] as Theme
        applyTheme(this.selectedTheme)
        this.updateThemeBtns(this.selectedTheme)
        await saveSettings(this.currentSettings())
      })
    })

    document.getElementById('debug-mode')!.addEventListener('change', async () => {
      this.options.onDebugModeChange((document.getElementById('debug-mode') as HTMLInputElement).checked)
      await saveSettings(this.currentSettings())
    })

    document.getElementById('email-on-site-found')?.addEventListener('change', async () => {
      await saveSettings(this.currentSettings())
    })

    document.getElementById('poll-interval')!.addEventListener('change', async () => {
      await saveSettings(this.currentSettings())
    })

    document.getElementById('log-sync-min-level')?.addEventListener('change', async () => {
      await saveSettings(this.currentSettings())
    })

    document.getElementById('test-notif-btn')?.addEventListener('click', () => {
      const id = `campsoon-test-${Date.now()}`
      chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title: 'campsoon - Notifications working',
        message: 'If you see this, notifications are set up correctly.',
        requireInteraction: false,
      }, createdId => {
        if (chrome.runtime.lastError) {
          alert(`Notification failed: ${chrome.runtime.lastError.message}\n\nCheck that Chrome has notification permission in macOS System Settings -> Notifications -> Google Chrome.`)
        } else {
          console.log('[campsoon] Test notification sent:', createdId)
        }
      })
    })
  }

  async loadForm(): Promise<void> {
    const { settings } = await getStorage()
    ;(document.getElementById('poll-interval') as HTMLSelectElement).value = String(settings.pollIntervalSeconds)
    const logSyncMinLevel = document.getElementById('log-sync-min-level') as HTMLSelectElement | null
    if (logSyncMinLevel) logSyncMinLevel.value = settings.logSyncMinLevel ?? 'info'
    const debugEl = document.getElementById('debug-mode') as HTMLInputElement
    debugEl.checked = settings.debugMode ?? false
    const emailOnSiteFoundEl = document.getElementById('email-on-site-found') as HTMLInputElement | null
    if (emailOnSiteFoundEl) emailOnSiteFoundEl.checked = settings.emailOnSiteFound ?? false
    this.options.onDebugModeChange(debugEl.checked)
    this.selectedTheme = settings.theme ?? 'auto'
    this.updateThemeBtns(this.selectedTheme)
  }

  private updateThemeBtns(theme: Theme): void {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset['themeChoice'] === theme)
    })
  }

  private currentSettings(): Settings {
    const logSyncMinLevel = document.getElementById('log-sync-min-level') as HTMLSelectElement | null
    return {
      pollIntervalSeconds: parseInt((document.getElementById('poll-interval') as HTMLSelectElement).value) as Settings['pollIntervalSeconds'],
      debugMode: (document.getElementById('debug-mode') as HTMLInputElement).checked,
      emailOnSiteFound: (document.getElementById('email-on-site-found') as HTMLInputElement | null)?.checked ?? false,
      theme: this.selectedTheme,
      logSyncMinLevel: (logSyncMinLevel?.value ?? 'info') as LogLevel,
    }
  }
}
