import type { ReservationProvider } from '../types'
import { providerInfo } from '../providers/config'

function isAuthCookie(cookie: Pick<chrome.cookies.Cookie, 'name' | 'value'>): boolean {
  return cookie.name === 'isLoggedIn' && cookie.value === 'true'
}

export async function isLoggedIn(provider: ReservationProvider = 'bc_parks'): Promise<boolean> {
  return new Promise(resolve =>
    chrome.cookies.getAll({ url: providerInfo(provider).baseUrl }, cookies =>
      resolve(cookies.some(isAuthCookie))
    )
  )
}

export function watchLoginChanges(onChange: (loggedIn: boolean) => void): void {
  chrome.cookies.onChanged.addListener((changeInfo: chrome.cookies.CookieChangeInfo) => {
    if (!changeInfo.cookie.domain.includes('camping.bcparks.ca') && !changeInfo.cookie.domain.includes('reservation.pc.gc.ca')) return
    if (changeInfo.cookie.name !== 'isLoggedIn') return
    // Any auth cookie added or removed → re-evaluate full state
    chrome.cookies.getAll({ url: 'https://camping.bcparks.ca' }, cookies =>
      onChange(cookies.some(isAuthCookie))
    )
  })
}
