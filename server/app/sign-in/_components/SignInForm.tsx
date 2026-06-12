'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';

type Step = 'email' | 'code';

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type: 'sign-in' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.message ?? data.error ?? 'server_error'));
      setStep('code');
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.message ?? data.error ?? 'server_error'));
      window.location.assign(nextPath || '/admin');
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-12">
      <main className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-950">Admin sign in</h1>
            <p className="text-sm text-slate-500">Use your Campsoon admin email.</p>
          </div>
        </div>

        {step === 'email' ? (
          <form className="grid gap-4" onSubmit={sendCode}>
            <label className="grid gap-1.5 text-sm font-bold text-slate-700">
              Email address
              <input
                className="admin-input"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={loading} type="submit">
              <Mail size={16} />
              {loading ? 'Sending...' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={verifyCode}>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              Code sent to {email}
            </div>
            <label className="grid gap-1.5 text-sm font-bold text-slate-700">
              Verification code
              <input
                className="admin-input text-center font-mono text-lg tracking-[0.2em]"
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </label>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={loading || code.length !== 6} type="submit">
              <KeyRound size={16} />
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <button className="text-sm font-bold text-slate-500 hover:text-slate-950" type="button" onClick={() => setStep('email')}>
              Use a different email
            </button>
          </form>
        )}

        {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
      </main>
    </div>
  );
}

function signInErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'server_error';
  if (/invalid email/i.test(message)) return 'Enter a valid email address.';
  if (/invalid|otp|code/i.test(message)) return 'That code did not work. Check it and try again.';
  if (/rate/i.test(message)) return 'Too many attempts. Wait a bit, then try again.';
  return 'Cannot sign in right now. Try again in a moment.';
}
