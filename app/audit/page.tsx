import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getClient, initSchema } from '@/lib/db';
import { TAU_FLOOR, deriveHealthBand } from '@/lib/kv';

// fix (2026-07-10): this route previously had no page.tsx at the index level
// -- only app/audit/[id]/page.tsx (a per-receipt detail view) existed, so
// hitting /audit directly fell through to a raw "Files within /audit/"
// directory listing instead of real content.
//
// Deliberately NOT built as a client-polling live feed (see
// components/LiveAuditFeed.tsx, which polls two endpoints every 5s for as
// long as a visitor's tab is open, and is already effectively duplicated by
// components/LiveStatsBar.tsx polling three endpoints every 10s on the
// homepage). Turso is reporting ~80% quota as of this writing -- adding a
// second perpetual-polling surface right now would make that worse, not
// better. This page is a plain server component instead: ONE query per
// `revalidate` window total, shared across every visitor via Next.js's ISR
// cache, regardless of traffic volume. A real-time feed can be reintroduced
// later once quota headroom is confirmed; a periodically-refreshed public
// log is the responsible default until then.
export const revalidate = 30;

export const metadata: Metadata = {
  title: 'Audit Log — Lex Aureon',
  description: 'Public, cryptographically-signed constitutional audit receipts. Every governed turn writes a SHA-256 receipt — input hash, output hash, and constitutional state — independently verifiable after the fact.',
  alternates: { canonical: 'https://www.lexaureon.com/audit' },
  openGraph: {
    title: 'Audit Log — Lex Aureon',
    description: 'Public, cryptographically-signed constitutional audit receipts, updated periodically.',
    url: 'https://www.lexaureon.com/audit',
    type: 'website',
  },
};

interface ReceiptRow {
  id: string;
  turn: number;
  m_before: number;
  m_after: number;
  governor_mode: string;
  intervention: boolean;
  timestamp: number;
}

// fix (2026-07-13) — HONEST EMPTY STATE: getRecentReceipts() previously
// caught ANY failure (including Turso's read-quota BLOCKED error) and
// returned [] indistinguishably from a genuinely empty table. The page then
// rendered "No receipts yet." either way -- actively misleading during a
// quota outage, where tens of thousands of real receipts exist and are
// simply unreadable right now, not nonexistent. Returns null specifically
// on a read failure so the page can render an honest, distinct message
// instead of implying the system has never processed anything.
async function getRecentReceipts(limit: number): Promise<ReceiptRow[] | null> {
  try {
    await initSchema();
    const r = await getClient().execute({
      sql: `SELECT receipt_id, turn, m_before, m_after, governor_mode, intervention, created_at
            FROM praxis_receipts
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [limit],
    });
    return r.rows.map(row => ({
      id: row.receipt_id as string,
      turn: row.turn as number,
      m_before: row.m_before as number,
      m_after: row.m_after as number,
      governor_mode: (row.governor_mode as string) || 'N/A',
      intervention: (row.intervention as number) === 1,
      timestamp: new Date(row.created_at as string).getTime(),
    }));
  } catch {
    return null;
  }
}

function formatAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function AuditIndexPage() {
  const receipts = await getRecentReceipts(50);

  return (
    <main style={{ background: '#07070d', minHeight: '100vh' }}>
      <nav className="sticky top-0 z-40 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(7,7,13,0.9)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-white text-sm">Lex Aureon</span>
          </Link>
          <span className="text-xs text-slate-600 font-mono">AUDIT LOG</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-8">
          <div className="text-xs font-mono uppercase tracking-widest mb-2 font-bold" style={{ color: '#c9a84c' }}>
            Public Transparency
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white mb-3">Constitutional Audit Log</h1>
          <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
            Every governed turn writes a SHA-256 receipt — the input hash, the output hash, and the
            constitutional state (C, R, S, M) — persisted append-only, so any decision can be
            independently re-verified after the fact. Below are the most recent receipts. Refreshed
            periodically, not real-time.
          </p>
          <p className="text-slate-600 text-[11px] font-mono max-w-2xl leading-relaxed mt-3">
            Note (2026-08-22): the GOVERNED/PASS classification now reflects the async governor
            correction and slow-drip accumulator in addition to the hard CBF-floor projection —
            previously it only reflected the latter. This applies to receipts written from this date
            forward; older rows in this log were classified under the narrower definition and have
            not been reclassified.
          </p>
        </div>

        {receipts === null ? (
          <div className="text-center py-20 border border-amber-500/20 rounded-2xl bg-amber-500/[0.04]">
            <div className="text-3xl mb-3">⚠</div>
            <p className="text-amber-400 text-sm font-semibold mb-1">Live receipts temporarily unavailable</p>
            <p className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
              The database read quota is currently exhausted. Real receipts continue to be
              generated on every governed turn — this list will repopulate automatically once
              read access resumes. This is not evidence of an empty log.
            </p>
          </div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-20 border border-white/5 rounded-2xl bg-white/[0.02]">
            <div className="text-3xl mb-3">📜</div>
            <p className="text-slate-500 text-sm">No receipts yet.</p>
            <Link href="/console" className="text-xs font-mono mt-3 inline-block hover:underline" style={{ color: '#c9a84c' }}>
              Run governance to generate one →
            </Link>
          </div>
        ) : (
          <div className="border border-white/5 rounded-2xl overflow-hidden bg-white/[0.02] divide-y divide-white/5">
            {receipts.map((r) => {
              const band = deriveHealthBand(r.m_after);
              const improved = r.m_after >= r.m_before;
              return (
                <Link
                  key={r.id}
                  href={`/audit/${encodeURIComponent(r.id)}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: r.intervention ? '#f59e0b' : '#10b981' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold"
                        style={{
                          color: r.intervention ? '#f59e0b' : '#10b981',
                          background: r.intervention ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        }}
                      >
                        {r.intervention ? 'GOVERNED' : 'PASS'}
                      </span>
                      <span className="text-xs text-slate-500 font-mono truncate">{r.id}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
                      <span className={improved ? 'text-emerald-500/80' : 'text-red-400/80'}>
                        M: {(r.m_before * 100).toFixed(0)}% → {(r.m_after * 100).toFixed(0)}%
                      </span>
                      <span
                        style={{ color: r.m_after >= TAU_FLOOR ? '#94a3b8' : '#f87171' }}
                      >
                        {band}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-slate-600 font-mono shrink-0">{formatAge(r.timestamp)}</span>
                </Link>
              );
            })}
          </div>
        )}

        <p className="text-center text-[11px] font-mono text-slate-600 mt-8">
          Every receipt is independently verifiable — tap any entry for its full cryptographic record.{' '}
          <Link href="/console" className="hover:underline" style={{ color: '#c9a84c' }}>Run your own →</Link>
        </p>
      </div>
    </main>
  );
}
