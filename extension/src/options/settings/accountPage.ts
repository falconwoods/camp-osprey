import { bindAccountPanel, renderAccountPanelHTML } from '../../accountPanel'
import { getAuth, getPendingStartTripId } from '../../storage'
import { consumePendingStartTripId } from '../../startAuthGate'

type AccountPageOptions = {
  openAuthDialog: () => Promise<void>
  renderHeaderAccount: () => Promise<void>
  renderTripList: () => Promise<void>
  startTripNow: (tripId: string) => Promise<boolean>
}

export class AccountPage {
  constructor(private readonly options: AccountPageOptions) {}

  async render(): Promise<void> {
    const root = document.getElementById('account-root')
    if (!root) return

    const auth = await getAuth()
    const pendingTripId = await getPendingStartTripId()
    root.innerHTML = renderAccountPanelHTML(auth, pendingTripId)
    document.getElementById('account-open-auth-btn')?.addEventListener('click', () => {
      void this.options.openAuthDialog()
    })

    bindAccountPanel(async () => {
      const tripId = await consumePendingStartTripId()
      if (tripId) await this.options.startTripNow(tripId)
      await this.render()
      await this.options.renderTripList()
    }, async () => {
      await this.render()
      await this.options.renderHeaderAccount()
    })
  }
}
