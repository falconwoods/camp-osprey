'use client';

import { ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';

type ReturnToCampsoonButtonProps = {
  className?: string;
  icon?: ReactNode;
};

export function ReturnToCampsoonButton({
  className = 'inline-flex h-[58px] w-full max-w-[310px] items-center justify-center gap-3 rounded-full bg-[#07934f] px-8 text-xl font-extrabold tracking-normal text-white shadow-[0_16px_34px_rgba(7,147,79,0.28)] transition hover:bg-[#078047] focus:outline-none focus:ring-2 focus:ring-[#07934f] focus:ring-offset-2',
  icon = <ExternalLink className="h-6 w-6" aria-hidden="true" />,
}: ReturnToCampsoonButtonProps) {
  const [message, setMessage] = useState<string | null>(null);

  function returnToCampsoon() {
    setMessage(null);
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get('return_url');
    const safeReturnUrl = sanitizeReturnUrl(returnUrl);
    const extensionId = sanitizeExtensionId(params.get('extension_id')) ?? getExtensionId(safeReturnUrl);
    const runtime = getChromeRuntime();

    if (extensionId && runtime?.sendMessage) {
      try {
        runtime.sendMessage(extensionId, { t: 7109 }, response => {
          const lastError = runtime.lastError;
          if (lastError || !response?.ok) {
            setMessage('Could not open Campsoon. Reload the Chrome extension, then try again.');
            return;
          }

          setMessage('Campsoon opened in a new tab.');
        });
      } catch {
        setMessage('Could not open Campsoon. Reload the Chrome extension, then try again.');
      }
      return;
    }

    if (safeReturnUrl && isWebReturnUrl(safeReturnUrl)) {
      window.location.assign(safeReturnUrl);
      return;
    }

    setMessage('Could not find the Campsoon extension return link.');
  }

  return (
    <div className="w-full max-w-[310px]">
      <button
        className={className}
        type="button"
        onClick={returnToCampsoon}
      >
        {icon}
        Return to Campsoon
      </button>
      {message ? <p className="mt-3 text-center text-sm font-semibold leading-5 text-[#526174] lg:text-left">{message}</p> : null}
    </div>
  );
}

function sanitizeReturnUrl(returnUrl: string | null): string | null {
  if (!returnUrl) return null;

  try {
    const url = new URL(returnUrl);
    if (url.protocol === 'chrome-extension:' || url.protocol === 'https:' || url.protocol === 'http:') {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeExtensionId(extensionId: string | null): string | null {
  const value = extensionId?.trim();
  if (!value) return null;
  return /^[a-p]{32}$/.test(value) ? value : null;
}

function getExtensionId(returnUrl: string | null): string | null {
  if (!returnUrl) return null;

  try {
    const url = new URL(returnUrl);
    if (url.protocol === 'chrome-extension:' && url.hostname) return url.hostname;
  } catch {
    return null;
  }

  return null;
}

function isWebReturnUrl(returnUrl: string): boolean {
  try {
    const url = new URL(returnUrl);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

type ChromeRuntime = {
  lastError?: { message?: string };
  sendMessage?: (
    extensionId: string,
    message: { t: number },
    responseCallback?: (response?: { ok?: boolean; error?: string }) => void,
  ) => void;
};

function getChromeRuntime(): ChromeRuntime | null {
  const globalChrome = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return globalChrome?.runtime ?? null;
}
