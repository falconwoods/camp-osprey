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
    <>
      <p>
        {required
          ? config?.forceUpdateMessage ?? 'This version of Campsoon is no longer supported for scanning.'
          : `A newer version of Campsoon is available.`}
      </p>
      {releaseNote?.title ? <p><strong>{releaseNote.title}</strong></p> : null}
      <dl className="update-version-details">
        <div>
          <dt>Current version</dt>
          <dd>{currentVersion}</dd>
        </div>
        {required ? (
          <div>
            <dt>Required version</dt>
            <dd>{requiredVersion} or newer</dd>
          </div>
        ) : null}
        <div>
          <dt>Latest version</dt>
          <dd>{latestVersion}</dd>
        </div>
      </dl>
      {!required && releaseNote?.summary ? <p>{releaseNote.summary}</p> : null}
      {releaseNote?.notes.length ? (
        <ul className="update-release-notes">
          {releaseNote.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
      <p className="update-install-note">Download and install the update, then reload the extension before starting scans again.</p>
    </>
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
