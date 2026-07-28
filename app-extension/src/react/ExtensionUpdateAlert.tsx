import { AppAlert } from '../components/AppAlert'
import {
  getCurrentExtensionVersion,
  getExtensionUpdateUrl,
  isForceUpdateRequired,
  isOptionalUpdateAvailable,
} from '../extensionConfig'
import type { ExtensionRemoteConfig } from '../types'

function openUpdateUrl(config: ExtensionRemoteConfig) {
  chrome.tabs.create({ url: getExtensionUpdateUrl(config) })
}

function UpdateReleaseDetails({
  config,
  required,
}: {
  config: ExtensionRemoteConfig | null
  required: boolean
}) {
  const currentVersion = getCurrentExtensionVersion()
  const requiredVersion = config?.minSupportedVersion ?? 'the latest version'
  const latestVersion = config?.latestVersion ?? requiredVersion
  const releaseNote = config?.releaseNote

  return (
    <div className="update-details">
      <p className="update-details-lead">
        {required
          ? `${config?.forceUpdateMessage ?? 'Please download the latest Campsoon extension to continue.'} Then install it and reload the extension before starting scans again.`
          : `A newer version of Campsoon is available.`}
      </p>
      {releaseNote?.title ? <p className="update-release-title">{releaseNote.title}</p> : null}
      <dl className="update-version-details">
        <div>
          <dt>Current version</dt>
          <dd><span className="update-version-badge">{currentVersion}</span></dd>
        </div>
        {required ? (
          <div>
            <dt>Required version</dt>
            <dd><span className="update-version-badge update-version-badge-required">{requiredVersion}+</span></dd>
          </div>
        ) : null}
        <div>
          <dt>Latest version</dt>
          <dd><span className="update-version-badge update-version-badge-latest">{latestVersion}</span></dd>
        </div>
      </dl>
      {!required && releaseNote?.summary ? <p className="update-release-summary">{releaseNote.summary}</p> : null}
      {releaseNote?.notes.length ? (
        <div className="update-release-notes">
          <span className="update-release-notes-label">What’s new</span>
          <ul>
          {releaseNote.notes.map(note => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function getRequiredUpdateSummary(config: ExtensionRemoteConfig | null): string {
  const currentVersion = getCurrentExtensionVersion()
  const requiredVersion = config?.minSupportedVersion ?? 'the latest version'
  const latestVersion = config?.latestVersion

  return latestVersion && latestVersion !== requiredVersion
    ? `Current version ${currentVersion}. Version ${requiredVersion} or newer is required; latest available is ${latestVersion}.`
    : `Current version ${currentVersion}. Version ${requiredVersion} or newer is required.`
}

export function RequiredUpdateDetails({ config }: { config: ExtensionRemoteConfig | null }) {
  return <UpdateReleaseDetails config={config} required />
}

export function OptionalUpdateDetails({ config }: { config: ExtensionRemoteConfig | null }) {
  return <UpdateReleaseDetails config={config} required={false} />
}

export function ExtensionUpdateAlert({
  config,
  onRequiredUpdate,
  onOptionalUpdate,
}: {
  config: ExtensionRemoteConfig | null
  onRequiredUpdate?: () => void
  onOptionalUpdate?: () => void
}) {
  if (!config) return null

  if (isForceUpdateRequired(config)) {
    return (
      <AppAlert
        variant="error"
        title="Update required"
        message={getRequiredUpdateSummary(config)}
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
      action={{ label: 'Download update', onClick: onOptionalUpdate ?? (() => openUpdateUrl(config)) }}
    />
  )
}
