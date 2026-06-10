import { Bell, Clock, Mail, Moon, Palette, Sun, SunMoon, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { saveSettings } from '../storage'
import { applyTheme } from '../theme'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/select'
import { getDefaultScanPolicy, resolveScanIntervalSeconds } from '../extensionConfig'
import type { ExtensionRemoteConfig, Settings, Theme } from '../types'

export function SettingsPanel({ settings, extensionConfig, onChanged }: { settings: Settings; extensionConfig: ExtensionRemoteConfig | null; onChanged: () => Promise<void> }) {
  const [savingTheme, setSavingTheme] = useState<Theme | null>(null)
  const scanPolicy = extensionConfig?.scanPolicy ?? getDefaultScanPolicy()
  const intervalOptions = scanPolicy.allowedIntervalSeconds.length
    ? scanPolicy.allowedIntervalSeconds
    : getDefaultScanPolicy().allowedIntervalSeconds
  const effectiveInterval = intervalOptions.includes(settings.pollIntervalSeconds)
    ? settings.pollIntervalSeconds
    : resolveScanIntervalSeconds(settings.pollIntervalSeconds, scanPolicy)

  async function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    await saveSettings(next)
    applyTheme(next.theme)
    await onChanged()
  }

  async function updateTheme(theme: Theme) {
    setSavingTheme(theme)
    try {
      await update({ theme })
    } finally {
      setSavingTheme(null)
    }
  }

  function testNotification() {
    chrome.notifications.create(`campsoon-test-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'campsoon - Notifications working',
      message: 'If you see this, notifications are set up correctly.',
      requireInteraction: false,
    }, () => {
      if (chrome.runtime.lastError) alert(`Notification failed: ${chrome.runtime.lastError.message}`)
    })
  }

  return (
    <div className="settings-main">
      <section className="settings-card">
        <div className="settings-card-title"><Palette className="icon" /> Theme</div>
        <div className="theme-btns">
          {themeButton('auto', 'Auto', 'Follow system', settings.theme, updateTheme, savingTheme, <SunMoon className="theme-icon" />)}
          {themeButton('light', 'Light', 'Light mode', settings.theme, updateTheme, savingTheme, <Sun className="theme-icon" />)}
          {themeButton('dark', 'Dark', 'Dark mode', settings.theme, updateTheme, savingTheme, <Moon className="theme-icon" />)}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title"><Clock className="icon" /> Check interval</div>
        <Select value={effectiveInterval} onChange={event => update({ pollIntervalSeconds: Number(event.target.value) })}>
          {intervalOptions.map(seconds => (
            <option value={seconds} key={seconds}>{formatIntervalOption(seconds, seconds === scanPolicy.defaultIntervalSeconds)}</option>
          ))}
        </Select>
        <div className="interval-risk-tip" role="note">
          <TriangleAlert size={15} />
          <div>
            <strong>Use faster intervals carefully</strong>
            <span>Shorter intervals can find openings faster, but they send more requests and may trigger rate limits, blocks, or account bans from booking providers. Choose them only if you accept that risk.</span>
          </div>
        </div>
      </section>

      <section className="settings-card email-alert-card">
        <div className="settings-card-title"><Mail className="icon" /> Email alerts</div>
        <div className="email-alert-list">
          <label className="email-alert-option" aria-disabled="true">
            <input type="checkbox" checked disabled readOnly />
            <span className="email-alert-copy">
              <span className="email-alert-title">Reserved or paid</span>
              <span className="email-alert-subtitle">Booking outcome emails are always sent to your signed-in account.</span>
            </span>
            <span className="email-alert-pill">Always on</span>
          </label>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title"><Bell className="icon" /> Notifications</div>
        <Button variant="secondary" onClick={testNotification}><Bell size={16} /> Test Notification</Button>
        <div className="notification-help"><strong>Tip</strong> If the test does not appear, check Chrome notification permissions in your OS notification settings, such as macOS System Settings or Windows Settings &gt; System &gt; Notifications.</div>
      </section>
    </div>
  )
}

function formatIntervalOption(seconds: number, recommended: boolean): string {
  return `${formatInterval(seconds)}${recommended ? ' (recommended)' : ''}`
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `Every ${seconds} seconds`
  const minutes = seconds / 60
  return `Every ${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minute${minutes === 1 ? '' : 's'}`
}

function themeButton(theme: Theme, label: string, subtitle: string, active: Theme, update: (theme: Theme) => Promise<void>, savingTheme: Theme | null, icon: React.ReactNode) {
  const loading = savingTheme === theme
  return (
    <button className={`theme-btn ${active === theme ? 'active' : ''}`} type="button" onClick={() => update(theme)} disabled={Boolean(savingTheme)} aria-busy={loading}>
      {icon}
      <span>{label}<span className="theme-subtitle">{loading ? 'Saving...' : subtitle}</span></span>
    </button>
  )
}
