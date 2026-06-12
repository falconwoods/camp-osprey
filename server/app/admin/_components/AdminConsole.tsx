'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Ban, CheckCircle2, Copy, Gift, History, Mail, RefreshCcw, Search, Send, ShieldAlert, UserCircle, Users, WalletCards } from 'lucide-react';

type AdminTab = 'recharge' | 'users';

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
          <AdminNavButton active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={17} />} label="Users" />
        </nav>
      </aside>
      <main className="min-w-0 px-7 py-6">
        {tab === 'recharge' ? <RechargeCodesTab /> : <UsersTab users={users} />}
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

function UsersTab({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState('');

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(row => (
      row.email.toLowerCase().includes(needle)
      || row.id.toLowerCase().includes(needle)
      || (row.name ?? '').toLowerCase().includes(needle)
    ));
  }, [query, users]);

  const totals = useMemo(() => users.reduce((acc, row) => ({
    pointBalance: acc.pointBalance + row.pointBalance,
    activeSessions: acc.activeSessions + row.activeSessions,
    paidBookings: acc.paidBookings + row.paidBookings,
    pointsEarned: acc.pointsEarned + row.pointsEarned,
  }), {
    pointBalance: 0,
    activeSessions: 0,
    paidBookings: 0,
    pointsEarned: 0,
  }), [users]);

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
        <UserMetric label="Users" value={users.length.toLocaleString()} />
        <UserMetric label="Current points" value={totals.pointBalance.toLocaleString()} />
        <UserMetric label="Points earned" value={totals.pointsEarned.toLocaleString()} />
        <UserMetric label="Paid bookings" value={totals.paidBookings.toLocaleString()} />
      </section>

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

function UserMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
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

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null): string {
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
    code_mismatch: 'This plaintext code does not match the stored code.',
    code_not_active: 'This code is not active.',
    code_expired: 'This code has expired.',
    not_found: 'Recharge code not found.',
  };
  return map[code] ?? 'Something went wrong. Try again.';
}
