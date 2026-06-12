import { AppAlert } from '../components/AppAlert'
import {
  getExtensionUpdateUrl,
  isForceUpdateRequired,
  isOptionalUpdateAvailable,
} from '../extensionConfig'
import type { ExtensionRemoteConfig } from '../types'

function openUpdateUrl(config: ExtensionRemoteConfig) {
  chrome.tabs.create({ url: getExtensionUpdateUrl(config) })
}

export function ExtensionUpdateAlert({
  config,
  onRequiredUpdate,
}: {
  config: ExtensionRemoteConfig | null
  onRequiredUpdate?: () => void
}) {
  if (!config) return null

  if (isForceUpdateRequired(config)) {
    return (
      <AppAlert
        variant="error"
        title="Update required"
        message={config.forceUpdateMessage ?? `Version ${config.minSupportedVersion} or newer is required.`}
        action={{ label: 'Download update', onClick: onRequiredUpdate ?? (() => openUpdateUrl(config)) }}
      />
    )
  }

  if (!isOptionalUpdateAvailable(config)) return null

  return (
    <AppAlert
      variant="info"
      title={config.releaseNote?.title ?? 'Update available'}
      message={config.releaseNote?.summary ?? `Version ${config.latestVersion} is available.`}
      action={{ label: 'Download update', onClick: () => openUpdateUrl(config) }}
    />
  )
}
