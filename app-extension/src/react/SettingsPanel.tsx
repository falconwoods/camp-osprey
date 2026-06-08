import { Bell, CalendarCheck, ChartNoAxesCombined, Clock, Mail, Moon, Palette, Sun, SunMoon } from 'lucide-react'
import { useState } from 'react'
import { saveSettings } from '../storage'
import { applyTheme } from '../theme'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/select'
import type { LogLevel, Settings, Theme } from '../types'

export function SettingsPanel({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [savingTheme, setSavingTheme] = useState<Theme | null>(null)

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
        <Select value={settings.pollIntervalSeconds} onChange={event => update({ pollIntervalSeconds: Number(event.target.value) as Settings['pollIntervalSeconds'] })}>
          <option value={10}>Every 10 seconds</option>
          <option value={30}>Every 30 seconds</option>
          <option value={60}>Every 60 seconds</option>
          <option value={120}>Every 2 minutes</option>
        </Select>
        <div className="setting-row-note">Chrome enforces a 30s minimum for published extensions. 10s works for the unpacked dev version.</div>
      </section>

      <section className="settings-card email-alert-card">
        <div className="settings-card-title"><Mail className="icon" /> Email alerts</div>
        <div className="email-alert-list">
          <label className="email-alert-option">
            <input type="checkbox" checked={settings.emailOnSiteFound} onChange={event => update({ emailOnSiteFound: event.target.checked })} />
            <span className="email-alert-copy">
              <span className="email-alert-title">Site found</span>
              <span className="email-alert-subtitle">Send an email as soon as campsoon finds an available site.</span>
            </span>
          </label>
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
        <div className="settings-card-title"><CalendarCheck className="icon" /> Debug mode</div>
        <label className="settings-check-label">
          <input type="checkbox" checked={settings.debugMode} onChange={event => update({ debugMode: event.target.checked })} />
          Enable debug mode
        </label>
        <div className="setting-row-note">Show additional logs and development information.</div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title"><ChartNoAxesCombined className="icon" /> Server log sync</div>
        <Select value={settings.logSyncMinLevel ?? 'info'} onChange={event => update({ logSyncMinLevel: event.target.value as LogLevel })}>
          <option value="debug">Debug and above</option>
          <option value="info">Info and above</option>
          <option value="warning">Warning and above</option>
          <option value="error">Error only</option>
        </Select>
        <div className="setting-row-note">Only logs at this level or higher are queued for server sync.</div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title"><Bell className="icon" /> Notifications</div>
        <Button variant="secondary" onClick={testNotification}><Bell size={16} /> Test Notification</Button>
        <div className="notification-help"><strong>Tip</strong> If the test does not appear, check Chrome notification permissions in macOS System Settings.</div>
      </section>
    </div>
  )
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
