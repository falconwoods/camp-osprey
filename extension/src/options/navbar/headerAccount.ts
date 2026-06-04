import { getAuth } from '../../storage'
import { icon } from '../settings/shared'

type HeaderAccountOptions = {
  openAuthDialog: () => Promise<void>
  showAccountTab: () => Promise<void>
}

export class HeaderAccount {
  constructor(private readonly options: HeaderAccountOptions) {}

  async render(): Promise<void> {
    const headerAccountEl = document.getElementById('header-account')
    if (!headerAccountEl) return
    const auth = await getAuth()
    const points = auth.user && typeof auth.pointsBalance === 'number'
      ? `${auth.pointsBalance.toLocaleString()} points`
      : null
    headerAccountEl.innerHTML = this.html(Boolean(auth.user), points)
    this.bind()
  }

  private html(signedIn: boolean, pointsLabel: string | null): string {
    if (signedIn) {
      return `<div class="account-cta account-cta-signed-in">
        <span class="account-check">${icon('user')}</span>
        <span>${pointsLabel ?? 'Points unavailable'}</span>
        <button class="icon-only-btn" type="button" id="open-account-btn" aria-label="Open account">${icon('chevronDown')}</button>
      </div>`
    }
    return `<button class="account-cta account-cta-warning account-sign-in-btn" type="button" id="open-account-btn">
      <span class="account-lock">${icon('lock')}</span>
      <span>Sign in</span>
    </button>`
  }

  private bind(): void {
    document.getElementById('open-account-btn')?.addEventListener('click', () => {
      void (async () => {
        const auth = await getAuth()
        if (auth.user) await this.options.showAccountTab()
        else await this.options.openAuthDialog()
      })()
    })
  }
}
