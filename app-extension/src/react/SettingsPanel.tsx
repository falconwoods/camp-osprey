import { Bell, Moon, Sun, SunMoon } from 'lucide-react'
import { useState } from 'react'
import { saveSettings } from '../storage'
import { applyTheme } from '../theme'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { LoadingButton } from '../components/ui/loading-button'
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
    <Card>
      <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
      <CardContent className="stack">
        <div className="field">
          <Label>Scan interval</Label>
          <Select value={settings.pollIntervalSeconds} onChange={event => update({ pollIntervalSeconds: Number(event.target.value) as Settings['pollIntervalSeconds'] })}>
            <option value={10}>10 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute</option>
            <option value={120}>2 minutes</option>
          </Select>
        </div>
        <div className="theme-picker">
          {themeButton('auto', settings.theme, updateTheme, savingTheme, <SunMoon size={16} />)}
          {themeButton('light', settings.theme, updateTheme, savingTheme, <Sun size={16} />)}
          {themeButton('dark', settings.theme, updateTheme, savingTheme, <Moon size={16} />)}
        </div>
        <label className="toggle-row"><input type="checkbox" checked={settings.debugMode} onChange={event => update({ debugMode: event.target.checked })} /> Debug logging</label>
        <label className="toggle-row"><input type="checkbox" checked={settings.emailOnSiteFound} onChange={event => update({ emailOnSiteFound: event.target.checked })} /> Email when a site is found</label>
        <div className="field">
          <Label>Server log sync level</Label>
          <Select value={settings.logSyncMinLevel ?? 'info'} onChange={event => update({ logSyncMinLevel: event.target.value as LogLevel })}>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </Select>
        </div>
        <Button variant="secondary" onClick={testNotification}><Bell size={16} /> Test Notification</Button>
      </CardContent>
    </Card>
  )
}

function themeButton(theme: Theme, active: Theme, update: (theme: Theme) => Promise<void>, savingTheme: Theme | null, icon: React.ReactNode) {
  const loading = savingTheme === theme
  return (
    <LoadingButton className={active === theme ? 'active' : ''} variant="ghost" onClick={() => update(theme)} disabled={Boolean(savingTheme)} loading={loading} loadingText={theme}>
      {icon}
      {theme}
    </LoadingButton>
  )
}
