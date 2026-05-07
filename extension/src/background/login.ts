export async function isLoggedIn(): Promise<boolean> {
  return new Promise(resolve =>
    chrome.cookies.get(
      { url: 'https://camping.bcparks.ca', name: 'isLoggedIn' },
      cookie => resolve(cookie?.value === 'true')
    )
  )
}

export function watchLoginChanges(onChange: (loggedIn: boolean) => void): void {
  chrome.cookies.onChanged.addListener((changeInfo: chrome.cookies.CookieChangeInfo) => {
    const { cookie, removed } = changeInfo
    if (cookie.domain.includes('camping.bcparks.ca') && cookie.name === 'isLoggedIn') {
      onChange(!removed && cookie.value === 'true')
    }
  })
}
