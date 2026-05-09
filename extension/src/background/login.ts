// Cookies set for anonymous BC Parks sessions (no login required)
const ANON_COOKIES = new Set(['XSRF-TOKEN', 'ARRAffinity', 'ARRAffinitySameSite'])

function isAuthCookie(name: string): boolean {
  return !ANON_COOKIES.has(name) && !name.startsWith('_ga') && !name.startsWith('_gid')
}

export async function isLoggedIn(): Promise<boolean> {
  return new Promise(resolve =>
    chrome.cookies.getAll({ url: 'https://camping.bcparks.ca' }, cookies =>
      resolve(cookies.some(c => isAuthCookie(c.name)))
    )
  )
}

export function watchLoginChanges(onChange: (loggedIn: boolean) => void): void {
  chrome.cookies.onChanged.addListener((changeInfo: chrome.cookies.CookieChangeInfo) => {
    if (!changeInfo.cookie.domain.includes('camping.bcparks.ca')) return
    if (!isAuthCookie(changeInfo.cookie.name)) return
    // Any auth cookie added or removed → re-evaluate full state
    chrome.cookies.getAll({ url: 'https://camping.bcparks.ca' }, cookies =>
      onChange(cookies.some(c => isAuthCookie(c.name)))
    )
  })
}
