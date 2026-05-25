function isAuthCookie(cookie: Pick<chrome.cookies.Cookie, 'name' | 'value'>): boolean {
  return cookie.name === 'isLoggedIn' && cookie.value === 'true'
}

export async function isLoggedIn(): Promise<boolean> {
  return new Promise(resolve =>
    chrome.cookies.getAll({ url: 'https://camping.bcparks.ca' }, cookies =>
      resolve(cookies.some(isAuthCookie))
    )
  )
}

export function watchLoginChanges(onChange: (loggedIn: boolean) => void): void {
  chrome.cookies.onChanged.addListener((changeInfo: chrome.cookies.CookieChangeInfo) => {
    if (!changeInfo.cookie.domain.includes('camping.bcparks.ca')) return
    if (changeInfo.cookie.name !== 'isLoggedIn') return
    // Any auth cookie added or removed → re-evaluate full state
    chrome.cookies.getAll({ url: 'https://camping.bcparks.ca' }, cookies =>
      onChange(cookies.some(isAuthCookie))
    )
  })
}
