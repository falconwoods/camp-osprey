'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Ban, CheckCircle2, Copy, Edit3, FileJson, Gift, History, MinusCircle, Plus, RefreshCcw, Save, Search, Send, Settings2, ShieldAlert, Trash2, UserCircle, Users, WalletCards, X } from 'lucide-react';

type AdminTab = 'recharge' | 'extensionConfig' | 'users';

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  role: string | null;
  banned: boolean;
  createdAt: string;
  trips: number;
  bookingResults: number;
  paidBookings: number;
  pointBalance: number;
  pointsEarned: number;
  pointsSpent: number;
  pointTransactions: number;
  activeSessions: number;
  authEvents: number;
  lastActivityAt: string | null;
};

type RechargeCode = {
  id: number;
  codePrefix: string;
  assignedEmail: string;
  assignedUserId: string | null;
  points: number;
  maxRedemptions: number;
  redeemedCount: number;
  status: 'active' | 'revoked' | 'expired' | 'fully_redeemed';
  expiresAt: string | null;
  note: string | null;
  sentAt: string | null;
  lastSentAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Redemption = {
  id: number;
  rechargeCodeId: number;
  userId: string;
  email: string;
  pointsGranted: number;
  createdAt: string;
};

type RechargeResponse = {
  codes: RechargeCode[];
  redemptions: Redemption[];
};

type GeneratedCode = {
  id: number;
  code: string;
  assignedEmail: string;
  points: number;
};

type ExtensionChannel = 'chrome_store' | 'website';
type RolloutState = 'hidden' | 'available' | 'paused';

type ExtensionConfigResponse = {
  channel: ExtensionChannel;
  latestVersion: string;
  minSupportedVersion: string;
  rolloutState: RolloutState;
  pollIntervalSeconds: number;
  downloadUrl?: string | null;
  forceUpdateMessage?: string | null;
  maintenance: {
    enabled: boolean;
    message?: string | null;
  };
  logSyncMinLevel: 'debug' | 'info' | 'warning' | 'error';
  scanPolicy: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  extraConfig: Record<string, unknown>;
  releaseNote: {
    version: string;
    title: string;
    summary?: string | null;
    notes: string[];
    changelogUrl?: string | null;
    publishedAt?: string | null;
  } | null;
  updatedAt: string;
  serverTime: string;
};

type ExtensionReleaseRow = NonNullable<ExtensionConfigResponse['releaseNote']> & {
  id: number;
  channel: ExtensionChannel;
  state: RolloutState;
  createdAt: string;
  updatedAt: string;
};

type ExtensionConfigFormState = {
  channel: ExtensionChannel;
  latestVersion: string;
  minSupportedVersion: string;
  rolloutState: RolloutState;
  pollIntervalSeconds: string;
  downloadUrl: string;
  forceUpdateMessage: string;
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  featureFlagsJson: string;
  extraConfigJson: string;
};

type ExtensionReleaseFormState = {
  version: string;
  state: RolloutState;
  title: string;
  summary: string;
  notes: string;
  changelogUrl: string;
  publishedAt: string;
};

const defaultExpiresAt = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

export function AdminConsole({ users }: { users: UserRow[] }) {
  const [tab, setTab] = useState<AdminTab>('recharge');

  return (
    <div className="grid min-h-[calc(100vh-73px)] grid-cols-[240px_minmax(0,1fr)] bg-slate-50">
      <aside className="border-r border-slate-200 bg-white px-4 py-5">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Gift size={22} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-950">campsoon</div>
            <div className="text-xs font-medium text-slate-500">Admin Console</div>
          </div>
        </div>
        <nav className="space-y-1">
          <AdminNavButton active={tab === 'recharge'} onClick={() => setTab('recharge')} icon={<Gift size={17} />} label="Recharge Codes" />
          <AdminNavButton active={tab === 'extensionConfig'} onClick={() => setTab('extensionConfig')} icon={<Settings2 size={17} />} label="Extension Config" />
          <AdminNavButton active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={17} />} label="Users" />
        </nav>
      </aside>
      <main className="min-w-0 px-7 py-6">
        {tab === 'recharge' ? <RechargeCodesTab /> : null}
        {tab === 'extensionConfig' ? <ExtensionConfigTab /> : null}
        {tab === 'users' ? <UsersTab users={users} /> : null}
      </main>
    </div>
  );
}

function AdminNavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
        active ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function RechargeCodesTab() {
  const [email, setEmail] = useState('');
  const [points, setPoints] = useState('1000');
  const [maxRedemptions, setMaxRedemptions] = useState('1');
  const [expiresAt, setExpiresAt] = useState(defaultExpiresAt);
  const [neverExpires, setNeverExpires] = useState(false);
  const [note, setNote] = useState('');
  const [sendNow, setSendNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [data, setData] = useState<RechargeResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const redemptionsByCode = useMemo(() => {
    const map = new Map<number, Redemption[]>();
    for (const redemption of data?.redemptions ?? []) {
      map.set(redemption.rechargeCodeId, [...(map.get(redemption.rechargeCodeId) ?? []), redemption]);
    }
    return map;
  }, [data]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoadingData(true);
    setError('');
    try {
      const response = await fetch('/api/admin/recharge-codes');
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      setData(json);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setLoadingData(false);
    }
  }

  async function createCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setGenerated(null);
    try {
      const response = await fetch('/api/admin/recharge-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignedEmail: email,
          points: Number(points),
          maxRedemptions: Number(maxRedemptions),
          expiresAt: neverExpires ? 'never' : expiresAt,
          note,
          sendNow,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      setGenerated({
        id: json.code.id,
        code: json.plainCode,
        assignedEmail: json.code.assignedEmail,
        points: json.code.points,
      });
      if (sendNow && json.emailSent === false) {
        setError('Code was generated, but the email could not be sent. Copy it or try Send Email again.');
      }
      setEmail('');
      setNote('');
      setSendNow(false);
      await refresh();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function sendGeneratedCode() {
    if (!generated) return;
    setSendingId(generated.id);
    setError('');
    try {
      const response = await fetch(`/api/admin/recharge-codes/${generated.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: generated.code }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      await refresh();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setSendingId(null);
    }
  }

  async function revokeCode(id: number) {
    if (!confirm('Revoke this recharge code?')) return;
    setRevokingId(id);
    setError('');
    try {
      const response = await fetch(`/api/admin/recharge-codes/${id}/revoke`, { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      await refresh();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Recharge Codes</h1>
          <p className="mt-1 text-sm text-slate-500">Generate offline payment codes, email them to users, and track redemption.</p>
        </div>
        <button type="button" onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
          <RefreshCcw size={15} />
          Refresh
        </button>
      </header>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <form className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,1.2fr)_120px_120px_170px_minmax(180px,1fr)_auto]" onSubmit={createCode}>
          <AdminField label="User email">
            <input className="admin-input" value={email} onChange={event => setEmail(event.target.value)} placeholder="user@example.com" type="email" required />
          </AdminField>
          <AdminField label="Points">
            <input className="admin-input" value={points} onChange={event => setPoints(event.target.value)} min="1" type="number" required />
          </AdminField>
          <AdminField label="Uses">
            <input className="admin-input" value={maxRedemptions} onChange={event => setMaxRedemptions(event.target.value)} min="1" type="number" required />
          </AdminField>
          <AdminField label="Expires">
            <input className="admin-input" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} type="date" disabled={neverExpires} />
          </AdminField>
          <AdminField label="Note">
            <input className="admin-input" value={note} onChange={event => setNote(event.target.value)} placeholder="Offline transfer memo" />
          </AdminField>
          <div className="flex items-end">
            <button className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={loading} type="submit">
              <Gift size={16} />
              {loading ? 'Generating...' : 'Generate'}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 lg:col-span-2">
            <input checked={sendNow} onChange={event => setSendNow(event.target.checked)} type="checkbox" />
            Send email immediately
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 lg:col-span-2">
            <input checked={neverExpires} onChange={event => setNeverExpires(event.target.checked)} type="checkbox" />
            Never expires
          </label>
        </form>
      </section>

      {generated ? (
        <section className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase text-emerald-700">Generated code</div>
              <div className="mt-1 font-mono text-xl font-black tracking-wide text-slate-950">{generated.code}</div>
              <div className="mt-1 text-sm text-emerald-900">{generated.assignedEmail} · {generated.points.toLocaleString()} points</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard.writeText(generated.code)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-800">
                <Copy size={15} />
                Copy
              </button>
              <button type="button" onClick={sendGeneratedCode} disabled={sendingId === generated.id} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
                <Send size={15} />
                {sendingId === generated.id ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-slate-950">Issued Codes</h2>
        </div>
        {loadingData && !data ? (
          <div className="p-5 text-sm font-semibold text-slate-500">Loading recharge codes...</div>
        ) : data?.codes.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3 text-right">Points</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.codes.map(code => (
                  <CodeRow
                    code={code}
                    redemptions={redemptionsByCode.get(code.id) ?? []}
                    revoking={revokingId === code.id}
                    onRevoke={() => revokeCode(code.id)}
                    key={code.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5 text-sm font-semibold text-slate-500">No recharge codes yet.</div>
        )}
      </section>
    </div>
  );
}

function CodeRow({
  code,
  redemptions,
  revoking,
  onRevoke,
}: {
  code: RechargeCode;
  redemptions: Redemption[];
  revoking: boolean;
  onRevoke: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canRevoke = code.status === 'active';

  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="px-4 py-3 font-mono font-bold text-slate-900">{code.codePrefix}...</td>
        <td className="px-4 py-3 text-slate-700">{code.assignedEmail}</td>
        <td className="px-4 py-3 text-right font-bold text-slate-900">{code.points.toLocaleString()}</td>
        <td className="px-4 py-3 text-slate-600">{code.redeemedCount}/{code.maxRedemptions}</td>
        <td className="px-4 py-3"><StatusPill status={code.status} /></td>
        <td className="px-4 py-3 text-slate-600">{formatDate(code.expiresAt)}</td>
        <td className="px-4 py-3 text-slate-600">{formatDate(code.lastSentAt)}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setExpanded(value => !value)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <History size={13} />
              {expanded ? 'Hide' : 'History'}
            </button>
            {canRevoke ? (
              <button type="button" onClick={onRevoke} disabled={revoking} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-60">
                <Ban size={13} />
                {revoking ? 'Revoking...' : 'Revoke'}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={8} className="px-4 py-3">
            <div className="grid gap-2 text-xs text-slate-600">
              <div><strong>Note:</strong> {code.note || 'None'}</div>
              <div><strong>Created:</strong> {formatDateTime(code.createdAt)}</div>
              {redemptions.length ? (
                <div className="grid gap-1">
                  <strong>Redemptions</strong>
                  {redemptions.map(redemption => (
                    <div key={redemption.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      {redemption.email} · +{redemption.pointsGranted.toLocaleString()} points · {formatDateTime(redemption.createdAt)}
                    </div>
                  ))}
                </div>
              ) : <div>No redemptions yet.</div>}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExtensionConfigTab() {
  const [channel, setChannel] = useState<ExtensionChannel>('website');
  const [config, setConfig] = useState<ExtensionConfigResponse | null>(null);
  const [releases, setReleases] = useState<ExtensionReleaseRow[]>([]);
  const [form, setForm] = useState<ExtensionConfigFormState>(() => defaultExtensionConfigForm('website'));
  const [releaseForm, setReleaseForm] = useState<ExtensionReleaseFormState>(() => defaultExtensionReleaseForm());
  const [editingReleaseVersion, setEditingReleaseVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [deletingReleaseVersion, setDeletingReleaseVersion] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void refreshAll(channel);
  }, [channel]);

  async function refreshAll(nextChannel = channel) {
    await Promise.all([refresh(nextChannel), refreshReleases(nextChannel)]);
  }

  async function refresh(nextChannel = channel) {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/extension/config?channel=${encodeURIComponent(nextChannel)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      const nextConfig = json as ExtensionConfigResponse;
      setConfig(nextConfig);
      setForm(formFromExtensionConfig(nextConfig));
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshReleases(nextChannel = channel) {
    try {
      const response = await fetch(`/api/admin/extension/releases?channel=${encodeURIComponent(nextChannel)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      setReleases(Array.isArray(json.releases) ? json.releases as ExtensionReleaseRow[] : []);
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const featureFlags = parseJsonRecord(form.featureFlagsJson, 'Feature flags');
      const extraConfig = parseJsonRecord(form.extraConfigJson, 'Extra config');
      const pollIntervalSeconds = Number(form.pollIntervalSeconds);
      if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
        throw new Error('Poll interval must be a positive integer.');
      }

      const response = await fetch('/api/admin/extension/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: form.channel,
          latestVersion: form.latestVersion,
          minSupportedVersion: form.minSupportedVersion,
          rolloutState: form.rolloutState,
          pollIntervalSeconds,
          downloadUrl: emptyToUndefined(form.downloadUrl),
          forceUpdateMessage: emptyToUndefined(form.forceUpdateMessage),
          maintenanceEnabled: form.maintenanceEnabled,
          maintenanceMessage: emptyToUndefined(form.maintenanceMessage),
          featureFlags,
          extraConfig,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      const nextConfig = json as ExtensionConfigResponse;
      setConfig(nextConfig);
      setForm(formFromExtensionConfig(nextConfig));
      setChannel(nextConfig.channel);
      setNotice('Extension config saved.');
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveRelease(event: FormEvent) {
    event.preventDefault();
    setReleaseSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/extension/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          version: releaseForm.version,
          state: releaseForm.state,
          title: releaseForm.title,
          summary: emptyToUndefined(releaseForm.summary),
          notes: releaseForm.notes.split('\n').map(note => note.trim()).filter(Boolean),
          changelogUrl: emptyToUndefined(releaseForm.changelogUrl),
          publishedAt: emptyToUndefined(releaseForm.publishedAt),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      setReleases(Array.isArray(json.releases) ? json.releases as ExtensionReleaseRow[] : []);
      setReleaseForm(defaultExtensionReleaseForm(form.latestVersion));
      setEditingReleaseVersion(null);
      setNotice('Release note saved.');
      await refresh(channel);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setReleaseSaving(false);
    }
  }

  async function deleteRelease(version: string) {
    if (!confirm(`Delete release note for ${version}?`)) return;
    setDeletingReleaseVersion(version);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/extension/releases', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, version }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? 'server_error'));
      setReleases(Array.isArray(json.releases) ? json.releases as ExtensionReleaseRow[] : []);
      if (editingReleaseVersion === version) {
        setReleaseForm(defaultExtensionReleaseForm(form.latestVersion));
        setEditingReleaseVersion(null);
      }
      setNotice('Release note deleted.');
      await refresh(channel);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setDeletingReleaseVersion(null);
    }
  }

  function editRelease(release: ExtensionReleaseRow) {
    setReleaseForm(formFromExtensionRelease(release));
    setEditingReleaseVersion(release.version);
  }

  function resetReleaseForm() {
    setReleaseForm(defaultExtensionReleaseForm(form.latestVersion));
    setEditingReleaseVersion(null);
  }

  function updateForm(patch: Partial<ExtensionConfigFormState>) {
    setForm(current => ({ ...current, ...patch }));
  }

  function updateReleaseForm(patch: Partial<ExtensionReleaseFormState>) {
    setReleaseForm(current => ({ ...current, ...patch }));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Extension Config</h1>
          <p className="mt-1 text-sm text-slate-500">Manage extension version gates, rollout state, scan policy, and remote flags.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="admin-input w-auto min-w-40"
            value={channel}
            onChange={event => setChannel(event.target.value as ExtensionChannel)}
          >
            <option value="chrome_store">Chrome Store</option>
            <option value="website">Website</option>
          </select>
          <button type="button" onClick={() => refreshAll()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" disabled={loading}>
            <RefreshCcw size={15} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <ConfigMetric label="Channel" value={config?.channel === 'website' ? 'Website' : 'Chrome Store'} />
        <ConfigMetric label="Latest" value={config?.latestVersion ?? 'Loading'} />
        <ConfigMetric label="Minimum" value={config?.minSupportedVersion ?? 'Loading'} />
        <ConfigMetric label="Updated" value={config ? formatDateTime(config.updatedAt) : 'Loading'} />
      </section>

      <form className="grid gap-5" onSubmit={saveConfig}>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Settings2 size={17} className="text-emerald-700" />
            <h2 className="text-base font-bold text-slate-950">Version and Rollout</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <AdminField label="Channel">
              <select className="admin-input" value={form.channel} onChange={event => updateForm({ channel: event.target.value as ExtensionChannel })}>
                <option value="chrome_store">Chrome Store</option>
                <option value="website">Website</option>
              </select>
            </AdminField>
            <AdminField label="Latest version">
              <input className="admin-input" value={form.latestVersion} onChange={event => updateForm({ latestVersion: event.target.value })} placeholder="0.1.0" required />
            </AdminField>
            <AdminField label="Minimum supported">
              <input className="admin-input" value={form.minSupportedVersion} onChange={event => updateForm({ minSupportedVersion: event.target.value })} placeholder="0.1.0" required />
            </AdminField>
            <AdminField label="Rollout state">
              <select className="admin-input" value={form.rolloutState} onChange={event => updateForm({ rolloutState: event.target.value as RolloutState })}>
                <option value="hidden">Hidden</option>
                <option value="available">Available</option>
                <option value="paused">Paused</option>
              </select>
            </AdminField>
            <AdminField label="Config poll seconds">
              <input className="admin-input" value={form.pollIntervalSeconds} onChange={event => updateForm({ pollIntervalSeconds: event.target.value })} min="1" type="number" required />
            </AdminField>
            <AdminField label="Download URL">
              <input className="admin-input" value={form.downloadUrl} onChange={event => updateForm({ downloadUrl: event.target.value })} placeholder="https://dub.sh/x2yQGXT" />
            </AdminField>
            <AdminField label="Force update message">
              <input className="admin-input" value={form.forceUpdateMessage} onChange={event => updateForm({ forceUpdateMessage: event.target.value })} placeholder="Please update Campsoon to continue." />
            </AdminField>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
              <input checked={form.maintenanceEnabled} onChange={event => updateForm({ maintenanceEnabled: event.target.checked })} type="checkbox" />
              Maintenance enabled
            </label>
            <div className="md:col-span-2 lg:col-span-4">
              <AdminField label="Maintenance message">
                <input className="admin-input" value={form.maintenanceMessage} onChange={event => updateForm({ maintenanceMessage: event.target.value })} placeholder="Short user-facing maintenance notice" />
              </AdminField>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileJson size={17} className="text-emerald-700" />
            <h2 className="text-base font-bold text-slate-950">Remote JSON</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <AdminField label="Feature flags">
              <textarea className="admin-input min-h-36 font-mono text-xs" value={form.featureFlagsJson} onChange={event => updateForm({ featureFlagsJson: event.target.value })} spellCheck={false} />
            </AdminField>
            <AdminField label="Extra config">
              <textarea className="admin-input min-h-36 font-mono text-xs" value={form.extraConfigJson} onChange={event => updateForm({ extraConfigJson: event.target.value })} spellCheck={false} />
            </AdminField>
          </div>
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
            `scanPolicy` and `logSyncMinLevel` live inside Extra config. The extension receives the normalized values shown by the public config response.
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-950">Public Response Preview</h2>
              <p className="mt-1 text-sm text-slate-500">Current normalized config returned to the extension.</p>
            </div>
            <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={saving || loading} type="submit">
              <Save size={16} />
              {saving ? 'Saving...' : 'Save config'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs font-semibold leading-relaxed text-slate-100">
            {config ? JSON.stringify(config, null, 2) : 'Loading...'}
          </pre>
        </section>
      </form>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History size={17} className="text-emerald-700" />
            <div>
              <h2 className="text-base font-bold text-slate-950">Release Notes</h2>
              <p className="mt-1 text-sm text-slate-500">Manage update notes separately from the channel config.</p>
            </div>
          </div>
          <button type="button" onClick={resetReleaseForm} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus size={15} />
            New release
          </button>
        </div>

        <form className="mb-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4" onSubmit={saveRelease}>
          <AdminField label="Version">
            <input className="admin-input" value={releaseForm.version} onChange={event => updateReleaseForm({ version: event.target.value })} placeholder={form.latestVersion} required />
          </AdminField>
          <AdminField label="State">
            <select className="admin-input" value={releaseForm.state} onChange={event => updateReleaseForm({ state: event.target.value as RolloutState })}>
              <option value="hidden">Hidden</option>
              <option value="available">Available</option>
              <option value="paused">Paused</option>
            </select>
          </AdminField>
          <div className="md:col-span-2">
            <AdminField label="Title">
              <input className="admin-input" value={releaseForm.title} onChange={event => updateReleaseForm({ title: event.target.value })} placeholder="Update available" required />
            </AdminField>
          </div>
          <div className="md:col-span-2">
            <AdminField label="Summary">
              <input className="admin-input" value={releaseForm.summary} onChange={event => updateReleaseForm({ summary: event.target.value })} placeholder="Short summary shown in the extension" />
            </AdminField>
          </div>
          <AdminField label="Changelog URL">
            <input className="admin-input" value={releaseForm.changelogUrl} onChange={event => updateReleaseForm({ changelogUrl: event.target.value })} placeholder="https://..." />
          </AdminField>
          <AdminField label="Published at">
            <input className="admin-input" value={releaseForm.publishedAt} onChange={event => updateReleaseForm({ publishedAt: event.target.value })} type="datetime-local" />
          </AdminField>
          <div className="md:col-span-2 lg:col-span-4">
            <AdminField label="Notes">
              <textarea className="admin-input min-h-24" value={releaseForm.notes} onChange={event => updateReleaseForm({ notes: event.target.value })} placeholder="One note per line" />
            </AdminField>
          </div>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-4">
            <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={releaseSaving} type="submit">
              <Save size={16} />
              {releaseSaving ? 'Saving...' : editingReleaseVersion ? 'Save release note' : 'Add release note'}
            </button>
            {editingReleaseVersion ? (
              <button type="button" onClick={resetReleaseForm} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <X size={16} />
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>

        {releases.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Published</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {releases.map(release => (
                  <tr className="border-b border-slate-100 align-top hover:bg-slate-50/70" key={`${release.channel}-${release.version}`}>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{release.version}</td>
                    <td className="px-4 py-3"><TinyPill label={release.state} tone={release.state === 'available' ? 'emerald' : release.state === 'paused' ? 'blue' : 'slate'} /></td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{release.title}</div>
                      {release.summary ? <div className="mt-1 text-xs text-slate-500">{release.summary}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(release.publishedAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(release.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => editRelease(release)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                          <Edit3 size={13} />
                          Edit
                        </button>
                        <button type="button" onClick={() => deleteRelease(release.version)} disabled={deletingReleaseVersion === release.version} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-60">
                          <Trash2 size={13} />
                          {deletingReleaseVersion === release.version ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">No release notes for this channel yet.</div>
        )}
      </section>
    </div>
  );
}

function UsersTab({ users }: { users: UserRow[] }) {
  const [rows, setRows] = useState(users);
  const [query, setQuery] = useState('');

  useEffect(() => setRows(users), [users]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => (
      row.email.toLowerCase().includes(needle)
      || row.id.toLowerCase().includes(needle)
      || (row.name ?? '').toLowerCase().includes(needle)
    ));
  }, [query, rows]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    pointBalance: acc.pointBalance + row.pointBalance,
    activeSessions: acc.activeSessions + row.activeSessions,
    paidBookings: acc.paidBookings + row.paidBookings,
    pointsEarned: acc.pointsEarned + row.pointsEarned,
  }), {
    pointBalance: 0,
    activeSessions: 0,
    paidBookings: 0,
    pointsEarned: 0,
  }), [rows]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Account health, point balances, and booking activity.</p>
        </div>
        <label className="relative block w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="admin-input w-full pl-9"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search email, name, or user ID"
            type="search"
          />
        </label>
      </header>

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <UserMetric label="Users" value={rows.length.toLocaleString()} />
        <UserMetric label="Current points" value={totals.pointBalance.toLocaleString()} />
        <UserMetric label="Points earned" value={totals.pointsEarned.toLocaleString()} />
        <UserMetric label="Paid bookings" value={totals.paidBookings.toLocaleString()} />
      </section>

      <ManualPointDeductionPanel users={rows} onDeducted={(result) => {
        setRows(current => current.map(row => row.id === result.userId ? {
          ...row,
          pointBalance: result.balanceAfter,
          pointsSpent: row.pointsSpent + result.pointsDeducted,
          pointTransactions: row.pointTransactions + 1,
          lastActivityAt: new Date().toISOString(),
        } : row));
      }} />

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3 text-right">Points</th>
                <th className="px-4 py-3 text-right">Earned</th>
                <th className="px-4 py-3 text-right">Spent</th>
                <th className="px-4 py-3 text-right">Trips</th>
                <th className="px-4 py-3 text-right">Results</th>
                <th className="px-4 py-3 text-right">Paid bookings</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(row => (
                <tr key={row.id} className="border-b border-slate-100 align-top hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <UserCircle className="mt-0.5 text-slate-400" size={16} />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{row.email}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {row.name ? <span>{row.name}</span> : null}
                          <span className="font-mono">{shortId(row.id)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1 font-black text-slate-950">
                      <WalletCards size={14} />
                      {row.pointBalance.toLocaleString()}
                    </span>
                    <div className="text-xs text-slate-400">{row.pointTransactions.toLocaleString()} tx</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700">{row.pointsEarned.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-700">{row.pointsSpent.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{row.trips.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{row.bookingResults.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.paidBookings.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <UserStatusPill row={row} />
                      {row.activeSessions > 0 ? <TinyPill label={`${row.activeSessions} active`} tone="blue" /> : null}
                      {row.role === 'admin' ? <TinyPill label="Admin" tone="emerald" /> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{formatDate(row.lastActivityAt)}</div>
                    <div className="text-xs text-slate-400">{row.authEvents.toLocaleString()} auth events</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredUsers.length ? (
          <div className="p-5 text-sm font-semibold text-slate-500">No users match that search.</div>
        ) : null}
      </section>
    </div>
  );
}

type DeductPointsResult = {
  userId: string;
  pointsDeducted: number;
  balanceAfter: number;
  transactionId: number;
};

function ManualPointDeductionPanel({
  users,
  onDeducted,
}: {
  users: UserRow[];
  onDeducted: (result: DeductPointsResult) => void;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!users.length) {
      setUserId('');
      return;
    }
    if (!users.some(row => row.id === userId)) setUserId(users[0].id);
  }, [userId, users]);

  const selectedUser = users.find(row => row.id === userId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/admin/points/deduct', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          points: Number(points),
          reason,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'server_error');
      const result = json as DeductPointsResult;
      onDeducted(result);
      setPoints('');
      setReason('');
      setSuccess(`Deducted ${result.pointsDeducted.toLocaleString()} points from ${selectedUser?.email ?? 'user'}.`);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-slate-950">
            <MinusCircle size={18} className="text-red-600" />
            Manual points deduction
          </div>
          <p className="mt-1 text-sm text-slate-500">Deduct points from a user and save the reason in their points ledger.</p>
        </div>
        {selectedUser ? (
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-right">
            <div className="text-xs font-bold uppercase text-slate-500">Selected balance</div>
            <div className="text-sm font-black text-slate-950">{selectedUser.pointBalance.toLocaleString()} points</div>
          </div>
        ) : null}
      </div>

      <form className="grid gap-3 lg:grid-cols-[minmax(220px,1.3fr)_160px_minmax(260px,1.5fr)_auto]" onSubmit={submit}>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-slate-500">User</span>
          <select className="admin-input w-full" value={userId} onChange={event => setUserId(event.target.value)} required>
            {users.map(row => (
              <option key={row.id} value={row.id}>{row.email} ({row.pointBalance.toLocaleString()} pts)</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Points</span>
          <input className="admin-input w-full" value={points} onChange={event => setPoints(event.target.value)} min="1" type="number" required />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Reason</span>
          <input className="admin-input w-full" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Refund reversal, abuse adjustment, support case..." required />
        </label>
        <div className="flex items-end">
          <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving || !users.length}>
            <MinusCircle size={16} />
            {saving ? 'Deducting...' : 'Deduct'}
          </button>
        </div>
      </form>
      {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
      {success ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{success}</div> : null}
    </section>
  );
}

function UserMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function ConfigMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-1 truncate text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function defaultExtensionConfigForm(channel: ExtensionChannel): ExtensionConfigFormState {
  return {
    channel,
    latestVersion: '0.1.0',
    minSupportedVersion: '0.1.0',
    rolloutState: 'hidden',
    pollIntervalSeconds: '600',
    downloadUrl: '',
    forceUpdateMessage: '',
    maintenanceEnabled: false,
    maintenanceMessage: '',
    featureFlagsJson: '{}',
    extraConfigJson: prettyJson({
      logSyncMinLevel: 'info',
      scanPolicy: {
        minIntervalSeconds: 60,
        maxIntervalSeconds: 300,
        defaultIntervalSeconds: 120,
        allowedIntervalSeconds: [60, 120, 180, 300],
        requestSpacingMs: 2000,
        maxRequestsPerCycle: 30,
        maxRequestsPerTripPerCycle: 8,
        backoff: {
          errorBaseSeconds: 300,
          rateLimitBaseSeconds: 600,
          maxSeconds: 1800,
        },
      },
    }),
  };
}

function formFromExtensionConfig(config: ExtensionConfigResponse): ExtensionConfigFormState {
  const extraConfig = {
    ...config.extraConfig,
    logSyncMinLevel: config.logSyncMinLevel,
    scanPolicy: config.scanPolicy,
  };

  return {
    channel: config.channel,
    latestVersion: config.latestVersion,
    minSupportedVersion: config.minSupportedVersion,
    rolloutState: config.rolloutState,
    pollIntervalSeconds: String(config.pollIntervalSeconds),
    downloadUrl: config.downloadUrl ?? '',
    forceUpdateMessage: config.forceUpdateMessage ?? '',
    maintenanceEnabled: config.maintenance.enabled,
    maintenanceMessage: config.maintenance.message ?? '',
    featureFlagsJson: prettyJson(config.featureFlags),
    extraConfigJson: prettyJson(extraConfig),
  };
}

function defaultExtensionReleaseForm(version = ''): ExtensionReleaseFormState {
  return {
    version,
    state: 'hidden',
    title: '',
    summary: '',
    notes: '',
    changelogUrl: '',
    publishedAt: '',
  };
}

function formFromExtensionRelease(release: ExtensionReleaseRow): ExtensionReleaseFormState {
  return {
    version: release.version,
    state: release.state,
    title: release.title,
    summary: release.summary ?? '',
    notes: release.notes.join('\n'),
    changelogUrl: release.changelogUrl ?? '',
    publishedAt: toDatetimeLocalValue(release.publishedAt),
  };
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${label} has invalid JSON.`);
    throw err;
  }
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toDatetimeLocalValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function UserStatusPill({ row }: { row: UserRow }) {
  if (row.banned) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
        <ShieldAlert size={12} />
        Banned
      </span>
    );
  }
  if (row.emailVerified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
        <CheckCircle2 size={12} />
        Verified
      </span>
    );
  }
  return <TinyPill label="Unverified" tone="slate" />;
}

function TinyPill({ label, tone }: { label: string; tone: 'blue' | 'emerald' | 'slate' }) {
  const styles = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    slate: 'border-slate-200 bg-slate-100 text-slate-600',
  };
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${styles[tone]}`}>{label}</span>;
}

function AdminField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold uppercase text-slate-500">
      {label}
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: RechargeCode['status'] }) {
  const styles = {
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    revoked: 'border-red-200 bg-red-50 text-red-700',
    expired: 'border-slate-200 bg-slate-100 text-slate-600',
    fully_redeemed: 'border-blue-200 bg-blue-50 text-blue-700',
  };
  const label = {
    active: 'Active',
    revoked: 'Revoked',
    expired: 'Expired',
    fully_redeemed: 'Fully redeemed',
  }[status];
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${styles[status]}`}>{label}</span>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function adminErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : 'server_error';
  const map: Record<string, string> = {
    invalid_email: 'Enter a valid user email.',
    invalid_points: 'Points must be a positive whole number.',
    invalid_max_redemptions: 'Uses must be a positive whole number.',
    invalid_expires_at: 'Choose a valid expiration date.',
    invalid_code: 'The generated code is missing or invalid.',
    invalid_user: 'Choose a user.',
    invalid_reason: 'Enter a reason for the adjustment.',
    user_not_found: 'User not found.',
    insufficient_points: 'This user does not have enough points to deduct that amount.',
    code_mismatch: 'This plaintext code does not match the stored code.',
    code_not_active: 'This code is not active.',
    code_expired: 'This code has expired.',
    not_found: 'Recharge code not found.',
    latestVersion_and_minSupportedVersion_required: 'Latest version and minimum supported version are required.',
    invalid_rollout_state: 'Choose a valid rollout state.',
    version_required: 'Release version is required.',
    title_required: 'Release title is required.',
    extension_config_required: 'Save the channel config before adding release notes.',
  };
  return map[code] ?? (code.includes(' ') ? code : 'Something went wrong. Try again.');
}
