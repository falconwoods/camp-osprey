import type { Theme } from './types'

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}
