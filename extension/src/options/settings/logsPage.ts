import { ALL_LOG_LEVELS, formatDebugLogAsJsonl, renderDebugLogRows } from '../../debugLog'
import { clearDebugLog, getDebugLog, getStorage } from '../../storage'
import type { LogLevel } from '../../types'

export class LogsPage {
  private selectedLogLevels = new Set<LogLevel>(ALL_LOG_LEVELS)
  private logAutoScroll = true
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  bind(): void {
    document.querySelectorAll('.log-level-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const level = (btn as HTMLElement).dataset['logLevel'] as LogLevel
        if (this.selectedLogLevels.has(level)) this.selectedLogLevels.delete(level)
        else this.selectedLogLevels.add(level)
        btn.classList.toggle('active', this.selectedLogLevels.has(level))
        await this.refresh()
      })
    })

    document.getElementById('log-autoscroll')!.addEventListener('change', () => {
      this.logAutoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement).checked
      if (this.logAutoScroll) {
        const box = document.getElementById('debug-log-box')
        if (box) box.scrollTop = box.scrollHeight
      }
    })

    document.getElementById('clear-log-btn')!.addEventListener('click', async () => {
      await clearDebugLog()
      await this.refresh()
    })

    document.getElementById('copy-log-jsonl-btn')!.addEventListener('click', async () => {
      const { debugLog } = await getStorage()
      const text = formatDebugLogAsJsonl(debugLog, this.selectedLogLevels)
      await navigator.clipboard.writeText(text)
      const btn = document.getElementById('copy-log-jsonl-btn')!
      const original = btn.textContent
      btn.textContent = 'Copied'
      window.setTimeout(() => { btn.textContent = original }, 1200)
    })
  }

  async refresh(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    const debugLog = await getDebugLog()
    const box = document.getElementById('debug-log-box')
    if (!box) return
    box.innerHTML = renderDebugLogRows(debugLog, this.selectedLogLevels)
    if (this.logAutoScroll) box.scrollTop = box.scrollHeight
  }

  scheduleRefresh(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, 250)
  }
}
