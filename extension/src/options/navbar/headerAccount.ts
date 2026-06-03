import { getAuth } from '../../storage'
import { escapeHtml, icon } from '../settings/shared'

type HeaderAccountOptions = {
  openAuthDialog: () => Promise<void>
  showAccountTab: () => Promise<void>
}

export class HeaderAccount {
  constructor(private readonly options: HeaderAccountOptions) {}

  async render(authEmail?: string | null): Promise<void> {
    const headerAccountEl = document.getElementById('header-account')
    if (!headerAccountEl) return
    const email = authEmail !== undefined ? authEmail : (await getAuth()).user?.email ?? null
    headerAccountEl.innerHTML = this.html(email)
    this.bind()
  }

  private html(authEmail: string | null): string {
    if (authEmail) {
      return `<div class="account-cta account-cta-signed-in">
        <span class="account-check">${icon('check')}</span>
        <span>Signed in as ${escapeHtml(authEmail)}</span>
        <button class="icon-only-btn" type="button" id="open-account-btn" aria-label="Open account">${icon('chevronDown')}</button>
      </div>`
    }
    return `<div class="account-cta account-cta-warning">
      <span class="account-lock">${icon('lock')}</span>
      <span class="account-cta-copy"><strong>Sign in to start trips</strong><br>Get booking emails and keep trips connected to your account.</span>
      <button class="trip-action-btn account-sign-in-btn" type="button" id="open-account-btn">Sign in</button>
    </div>`
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
