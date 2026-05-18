'use client';

import { useEffect, useState } from 'react';

/**
 * Surfaces critical service misconfiguration to operators visiting the site.
 * Dismissable per-session; reappears if config changes. No-op when all
 * required env vars are set.
 */
export default function ConfigBanner() {
  const [missing, setMissing] = useState<string[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/config-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { missing?: string[] } | null) => {
        if (d?.missing?.length) setMissing(d.missing);
      })
      .catch(() => { /* silent — banner is best-effort */ });

    try {
      if (sessionStorage.getItem('lex_config_banner_dismissed') === '1') {
        setDismissed(true);
      }
    } catch { /* sessionStorage may be unavailable */ }
  }, []);

  if (!missing?.length || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full font-mono text-xs px-4 py-2 flex items-center gap-2 border-b"
      style={{ background: '#1c1005', borderColor: '#7c2d12', color: '#fbbf24' }}
    >
      <span aria-hidden>⚠</span>
      <span className="flex-1 truncate">
        Degraded mode — missing config: <strong>{missing.join(', ')}</strong>.
        The governor pipeline will return explicit errors until this is set.
      </span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try { sessionStorage.setItem('lex_config_banner_dismissed', '1'); } catch { /* noop */ }
        }}
        className="px-2 py-0.5 rounded transition-opacity hover:opacity-80 flex-shrink-0"
        style={{ background: '#78350f', color: '#fef3c7', border: '1px solid #92400e' }}
        aria-label="Dismiss configuration warning"
      >
        dismiss
      </button>
    </div>
  );
}
