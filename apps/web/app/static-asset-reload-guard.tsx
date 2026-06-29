'use client';

import { useEffect } from 'react';

const reloadAttemptKey = 'ldpass.static-asset-reload.last-attempt';
const reloadCooldownMs = 30_000;

function shouldReloadForUrl(value: unknown): boolean {
  return typeof value === 'string' && value.includes('/_next/static/');
}

function shouldReloadForReason(reason: unknown): boolean {
  const message =
    reason instanceof Error
      ? `${reason.name} ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : '';

  return (
    message.includes('ChunkLoadError') ||
    message.includes('Loading chunk') ||
    message.includes('CSS_CHUNK_LOAD_FAILED') ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('/_next/static/')
  );
}

function reloadOnce(): void {
  const now = Date.now();
  const lastAttempt = Number(window.sessionStorage.getItem(reloadAttemptKey) ?? '0');

  if (Number.isFinite(lastAttempt) && now - lastAttempt < reloadCooldownMs) {
    return;
  }

  window.sessionStorage.setItem(reloadAttemptKey, String(now));
  window.location.reload();
}

export function StaticAssetReloadGuard() {
  useEffect(() => {
    const handleResourceError = (event: ErrorEvent) => {
      const target = event.target;

      if (target instanceof HTMLScriptElement && shouldReloadForUrl(target.src)) {
        reloadOnce();
        return;
      }

      if (target instanceof HTMLLinkElement && shouldReloadForUrl(target.href)) {
        reloadOnce();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (shouldReloadForReason(event.reason)) {
        reloadOnce();
      }
    };

    window.addEventListener('error', handleResourceError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleResourceError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
