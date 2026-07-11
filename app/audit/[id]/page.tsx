import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getClient } from '@/lib/db';
import { TAU_FLOOR, deriveHealthBand } from '@/lib/kv';
import PrintButton from '@/components/PrintButton';

interface Props { params: Promise<{ id: string }> }

// fix (2026-07-11) — TOOL-CALL RECEIPTS WERE INVISIBLE ON THE PUBLIC AUDIT
// TRAIL: this page only ever queried praxis_receipts (text-governance
// receipts, format KRN-XXXXXXXX-XXXX). The new tool-call governance layer
// (lib/agents/tool_interceptor.ts) writes to a separate table, tool_receipts
// (format TCR-XXXXXXXXXXXXXXXX) — a real, cryptographically-meaningful
// receipt that was nonetheless returning "Receipt Not Found" here, despite
// genuinely existing in the database. Caught by testing a real
// write_file_governed call end-to-end and checking whether its receipt
// actually resolved on this page — it didn't. Now checks praxis_receipts
// first (unchanged), falls back to tool_receipts if not found there, and
// renders an appropriately different layout for the tool-call case (its
// fields — decision, tool_name, C/R/S/M, risk_level, sigma_viol, reason —
// don't map onto the text-receipt fields, so this isn't a shared template,
// it's two real, distinct receipt types under one lookup).

interface TextAuditEntry {
  kind: 'text';
  id: string;
  session_id: string;
  turn: number;
  timestamp: number;
  m_before: number;
  m_after: number;
  pre_eval_label: string;
  governor_mode: string;
  intervention: boolean;
  slow_drip: boolean;
  governor_effort: number;
  sigma_viol: number;
}

interface ToolAuditEntry {
  kind: 'tool';
  id: string;
  session_id: string;
  tool_name: string;
  decision: string;
  c: number; r: number; s: number; m: number;
  risk_level: string;
  sigma_viol: number;
  reason: string;
  timestamp: number;
}

type AuditEntry = TextAuditEntry | ToolAuditEntry;

type AuditResult =
  | { ok: true; entry: AuditEntry }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'db_error'; message: string };

async function getAuditEntry(id: string): Promise<AuditResult> {
  const db = getClient();
  if (!db) return { ok: false, reason: 'db_error', message: 'No database client available' };
  try {
    const textRes = await db.execute({
      sql: `SELECT receipt_id, session_id, turn, pre_eval_label,
                   m_before, m_after, governor_mode, intervention,
                   slow_drip, governor_effort, sigma_viol, created_at
            FROM praxis_receipts WHERE receipt_id = ?`,
      args: [id],
    });
    if (textRes.rows.length) {
      const row = textRes.rows[0];
      return {
        ok: true,
        entry: {
          kind: 'text',
          id: row.receipt_id as string,
          session_id: row.session_id as string,
          turn: row.turn as number,
          timestamp: new Date(row.created_at as string).getTime(),
          m_before: row.m_before as number,
          m_after: row.m_after as number,
          pre_eval_label: (row.pre_eval_label as string) || 'CLEAR',
          governor_mode: (row.governor_mode as string) || 'N/A',
          intervention: (row.intervention as number) === 1,
          slow_drip: (row.slow_drip as number) === 1,
          governor_effort: row.governor_effort as number,
          sigma_viol: row.sigma_viol as number,
        },
      };
    }

    // fix (2026-07-11): fall back to tool_receipts — see file header.
    const toolRes = await db.execute({
      sql: `SELECT receipt_id, session_id, tool_name, decision,
                   c_score, r_score, s_score, m_score, risk_level,
                   sigma_viol, reason, created_at
            FROM tool_receipts WHERE receipt_id = ?`,
      args: [id],
    });
    if (toolRes.rows.length) {
      const row = toolRes.rows[0];
      return {
        ok: true,
        entry: {
          kind: 'tool',
          id: row.receipt_id as string,
          session_id: row.session_id as string,
          tool_name: row.tool_name as string,
          decision: row.decision as string,
          c: row.c_score as number, r: row.r_score as number,
          s: row.s_score as number, m: row.m_score as number,
          risk_level: row.risk_level as string,
          sigma_viol: row.sigma_viol as number,
          reason: row.reason as string,
          timestamp: new Date(row.created_at as string).getTime(),
        },
      };
    }

    return { ok: false, reason: 'not_found' };
  } catch (e) {
    console.error('[audit] db error for id', id, e);
    return { ok: false, reason: 'db_error', message: String(e) };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await getAuditEntry(id);

  if (!result.ok) {
    return {
      title: `Audit Receipt ${id} — Lex Aureon`,
      description: 'Constitutional governance audit receipt.',
      robots: { index: false },
    };
  }

  const e = result.entry;

  if (e.kind === 'text') {
    const m = ((e.m_after ?? 0) * 100).toFixed(1);
    const verdict = e.intervention ? 'Governor intervened' : 'Clean constitutional pass';
    const desc = `${verdict} · M=${m}% · ${e.governor_mode} · turn ${e.turn}. Cryptographically signed PRAXIS v1.0 receipt.`;
    return {
      title: `Receipt ${id.slice(0, 12)}… · M=${m}% — Lex Aureon`,
      description: desc,
      openGraph: { title: `Audit Receipt · ${verdict}`, description: desc, type: 'article', images: [{ url: '/logo.png', width: 1080, height: 1080 }] },
      twitter: { card: 'summary_large_image', title: `Audit Receipt · M=${m}%`, description: desc },
    };
  }

  // tool receipt
  const desc = `${e.decision} · ${e.tool_name} · M=${(e.m * 100).toFixed(1)}% · risk=${e.risk_level}. Cryptographically signed tool-call governance receipt.`;
  return {
    title: `Tool Receipt ${id.slice(0, 12)}… · ${e.decision} — Lex Aureon`,
    description: desc,
    openGraph: { title: `Tool-Call Receipt · ${e.decision}`, description: desc, type: 'article', images: [{ url: '/logo.png', width: 1080, height: 1080 }] },
    twitter: { card: 'summary_large_image', title: `Tool Receipt · ${e.decision}`, description: desc },
  };
}

export default async function AuditPage({ params }: Props) {
  const { id } = await params;
  const result = await getAuditEntry(id);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-doc { box-shadow: none !important; border: 1px solid #ccc !important; }
        }
      `}</style>

      {/* Nav */}
      <nav
        className="sticky top-0 z-40 border-b border-white/5 backdrop-blur-xl no-print"
        style={{ background: 'rgba(7,7,13,0.9)' }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-white text-sm">Lex Aureon</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600 font-mono">AUDIT RECEIPT</span>
            {result.ok && <PrintButton />}
          </div>
        </div>
      </nav>

      <main style={{ background: '#07070d', minHeight: '100vh', paddingBottom: '4rem' }}>
        <div className="max-w-xl mx-auto px-4 py-10">

          {/* ── DB Error ─────────────────────────────── */}
          {!result.ok && result.reason === 'db_error' && (
            <div className="text-center py-20">
              <div className="text-4xl mb-4">⚠️</div>
              <h1 className="text-xl font-bold text-white mb-2">Database Error</h1>
              <p className="text-slate-500 text-sm mb-2">
                Database error — run a governance session first
              </p>
              <p className="text-slate-700 text-xs font-mono mb-6 max-w-xs mx-auto break-all">
                {result.message}
              </p>
              <Link
                href="/console"
                className="text-sm font-mono px-4 py-2 rounded-lg transition-all hover:opacity-80"
                style={{ color: '#07070d', background: '#c9a84c' }}
              >
                Run governance to generate a receipt
              </Link>
            </div>
          )}

          {/* ── Not Found ────────────────────────────── */}
          {!result.ok && result.reason === 'not_found' && (
            <div className="text-center py-20">
              <div className="text-4xl mb-4">🔍</div>
              <h1 className="text-xl font-bold text-white mb-2">Receipt Not Found</h1>
              <p className="text-slate-500 text-sm mb-1">
                No audit receipt exists for ID:
              </p>
              <p className="text-slate-600 text-xs font-mono mb-6 break-all">{id}</p>
              <Link
                href="/console"
                className="text-sm font-mono px-4 py-2 rounded-lg transition-all hover:opacity-80"
                style={{ color: '#07070d', background: '#c9a84c' }}
              >
                Run governance to generate a receipt
              </Link>
            </div>
          )}

          {/* ── Legal Document Card · TEXT receipt ────── */}
          {result.ok && result.entry.kind === 'text' && (() => {
            const entry = result.entry;
            const healthBand = deriveHealthBand(entry.m_after);
            return (
              <div
                className="print-doc rounded-2xl overflow-hidden"
                style={{
                  background: '#f5f0e8',
                  color: '#1a1209',
                  boxShadow: '0 0 0 1px rgba(201,168,76,0.3), 0 40px 80px rgba(0,0,0,0.6)',
                }}
              >
                {/* Document header */}
                <div
                  className="px-4 sm:px-8 pt-8 pb-6 text-center border-b"
                  style={{ borderColor: '#d4b896', background: '#ede8dc' }}
                >
                  <div
                    className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl border-2"
                    style={{ borderColor: '#c9a84c', background: '#f5f0e8', boxShadow: '0 0 0 4px #c9a84c20' }}
                  >
                    ⚖
                  </div>
                  <div className="text-xs font-mono tracking-[0.2em] uppercase mb-1" style={{ color: '#8b6914' }}>
                    Lex Intelligence Systems · Aureonics Framework
                  </div>
                  <h1 className="text-2xl font-black mb-1" style={{ color: '#1a1209', fontFamily: 'Georgia, serif' }}>
                    Constitutional Audit Receipt
                  </h1>
                  <div className="text-xs font-mono" style={{ color: '#8b6914' }}>
                    PRAXIS v1.0 · Article IV: Audit and Continuity
                  </div>
                </div>

                {/* Receipt ID */}
                <div className="px-4 sm:px-8 py-4 border-b" style={{ borderColor: '#d4b896', background: '#f0ead8' }}>
                  <div className="text-xs font-mono mb-1" style={{ color: '#8b6914' }}>RECEIPT IDENTIFIER</div>
                  <div className="text-sm font-mono font-bold break-all" style={{ color: '#1a1209' }}>
                    {entry.id}
                  </div>
                  <div className="text-xs font-mono mt-2" style={{ color: '#a07830' }}>
                    SHA-256 · Cryptographically Signed · Immutable
                  </div>
                </div>

                {/* Gold rule */}
                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § I · Constitutional State */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § I · Constitutional State
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'M Score (Before)', value: `${((entry.m_before ?? 0) * 100).toFixed(1)}%`, sub: 'Pre-governance stability margin', ok: entry.m_before > TAU_FLOOR },
                      { label: 'M Score (After)', value: `${((entry.m_after ?? 0) * 100).toFixed(1)}%`, sub: 'Post-governance stability margin', ok: entry.m_after > TAU_FLOOR },
                      { label: 'Health Band', value: healthBand, sub: 'Constitutional classification', ok: healthBand === 'OPTIMAL' || healthBand === 'ALERT' },
                      { label: 'M Trajectory', value: entry.m_after >= entry.m_before ? 'IMPROVING ↑' : 'RECOVERING ↓', sub: 'Stability margin direction (M before → after)', ok: entry.m_after >= entry.m_before },
                    ].map(({ label, value, sub, ok }) => (
                      <div key={label} className="rounded-lg p-3" style={{ background: '#e8e0cc', border: '1px solid #d4b896' }}>
                        <div className="text-xs font-mono mb-1" style={{ color: '#8b6914' }}>{label}</div>
                        <div className="text-sm font-bold font-mono" style={{ color: ok ? '#166534' : '#7f1d1d' }}>{value}</div>
                        <div className="text-xs mt-0.5" style={{ color: '#a07830' }}>{sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gold rule */}
                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § II · Governor Action */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § II · Governor Action
                  </div>
                  <div
                    className="rounded-lg p-4"
                    style={{
                      background: entry.intervention ? '#fef3c7' : '#d1fae5',
                      border: `1px solid ${entry.intervention ? '#f59e0b50' : '#10b98150'}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{entry.intervention ? '⚡' : '✓'}</span>
                      <span className="text-sm font-bold font-mono" style={{ color: entry.intervention ? '#92400e' : '#065f46' }}>
                        {entry.intervention ? 'GOVERNOR INTERVENED' : 'CLEAN PASS — NO INTERVENTION'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs font-mono" style={{ color: '#78350f' }}>
                      <span>Mode: {entry.governor_mode}</span>
                      <span>Effort: {((entry.governor_effort ?? 0) * 100).toFixed(1)}%</span>
                      {entry.slow_drip && <span style={{ color: '#b45309' }}>⚠ Slow-drip detected</span>}
                    </div>
                  </div>
                </div>

                {/* Gold rule */}
                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § III · Governance Record */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § III · Governance Record
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Receipt ID', value: entry.id },
                      { label: 'Session', value: entry.session_id ? entry.session_id.slice(0, 28) + (entry.session_id.length > 28 ? '...' : '') : 'N/A' },
                      { label: 'Turn', value: String(entry.turn ?? 'N/A') },
                      { label: 'Pre-eval Label', value: entry.pre_eval_label },
                      { label: 'Sigma Violation', value: entry.sigma_viol != null ? entry.sigma_viol.toFixed(4) : 'N/A' },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded p-2.5 font-mono text-xs" style={{ background: '#e8e0cc', border: '1px solid #d4b896' }}>
                        <span className="mr-2" style={{ color: '#8b6914' }}>{label}:</span>
                        <span className="break-all" style={{ color: '#1a1209' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gold rule */}
                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § IV · Timestamp */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § IV · Timestamp
                  </div>
                  <div className="text-sm font-mono" style={{ color: '#1a1209' }}>
                    {entry.timestamp ? new Date(entry.timestamp).toISOString() : 'N/A'}
                  </div>
                  <div className="text-xs font-mono mt-1" style={{ color: '#a07830' }}>
                    UTC · Unix epoch: {entry.timestamp ?? 'N/A'}
                  </div>
                </div>

                {/* Gold rule */}
                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* Stamp + links */}
                <div className="px-4 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono" style={{ color: '#8b6914' }}>
                      This receipt is governed by the Lex Aureon Constitution v1.0.
                      <br />Article IV: Audit and Continuity.
                    </div>
                    <div className="flex gap-3 mt-3">
                      <Link href="/constitution" className="text-xs font-mono transition-colors hover:underline" style={{ color: '#c9a84c' }}>
                        View Constitution ↗
                      </Link>
                      <Link href="/console" className="text-xs font-mono transition-colors hover:underline" style={{ color: '#3b82f6' }}>
                        Run Governance ↗
                      </Link>
                    </div>
                  </div>
                  <div
                    className="flex-shrink-0 px-5 py-3 rounded-xl border-2 text-center rotate-[-3deg]"
                    style={{ borderColor: '#166534', background: 'rgba(22,101,52,0.06)', color: '#166534' }}
                  >
                    <div className="text-xs font-black tracking-widest font-mono leading-tight">
                      CONSTITUTIONALLY<br />VERIFIED
                    </div>
                    <div className="text-xs font-mono mt-1" style={{ opacity: 0.7 }}>PRAXIS v1.0</div>
                  </div>
                </div>

                {/* Document footer */}
                <div className="px-4 sm:px-8 py-3 text-center border-t" style={{ borderColor: '#d4b896', background: '#ede8dc' }}>
                  <div className="text-xs font-mono" style={{ color: '#a07830' }}>
                    © 2026 Lex Intelligence Systems · Emmanuel King · Lagos, Nigeria
                    <br />doi.org/10.5281/zenodo.18944243 · PRAXIS v1.0 · C+R+S=1
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Legal Document Card · TOOL-CALL receipt (2026-07-11) ──── */}
          {result.ok && result.entry.kind === 'tool' && (() => {
            const entry = result.entry;
            const approved = entry.decision.startsWith('APPROVED');
            return (
              <div
                className="print-doc rounded-2xl overflow-hidden"
                style={{
                  background: '#f5f0e8',
                  color: '#1a1209',
                  boxShadow: '0 0 0 1px rgba(201,168,76,0.3), 0 40px 80px rgba(0,0,0,0.6)',
                }}
              >
                <div className="px-4 sm:px-8 pt-8 pb-6 text-center border-b" style={{ borderColor: '#d4b896', background: '#ede8dc' }}>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl border-2"
                    style={{ borderColor: '#c9a84c', background: '#f5f0e8', boxShadow: '0 0 0 4px #c9a84c20' }}>
                    ⚙
                  </div>
                  <div className="text-xs font-mono tracking-[0.2em] uppercase mb-1" style={{ color: '#8b6914' }}>
                    Lex Intelligence Systems · Aureonics Framework
                  </div>
                  <h1 className="text-2xl font-black mb-1" style={{ color: '#1a1209', fontFamily: 'Georgia, serif' }}>
                    Tool-Call Governance Receipt
                  </h1>
                  <div className="text-xs font-mono" style={{ color: '#8b6914' }}>
                    Agentic constitutional layer · Article 0.5: Tool Call Interceptor
                  </div>
                </div>

                <div className="px-4 sm:px-8 py-4 border-b" style={{ borderColor: '#d4b896', background: '#f0ead8' }}>
                  <div className="text-xs font-mono mb-1" style={{ color: '#8b6914' }}>RECEIPT IDENTIFIER</div>
                  <div className="text-sm font-mono font-bold break-all" style={{ color: '#1a1209' }}>{entry.id}</div>
                  <div className="text-xs font-mono mt-2" style={{ color: '#a07830' }}>
                    Cryptographically Signed · Immutable · Independent of the agent&rsquo;s own judgment
                  </div>
                </div>

                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § I · Decision */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § I · Governance Decision
                  </div>
                  <div className="rounded-lg p-4" style={{
                    background: approved ? '#d1fae5' : '#fee2e2',
                    border: `1px solid ${approved ? '#10b98150' : '#ef444450'}`,
                  }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{approved ? '✓' : '✗'}</span>
                      <span className="text-sm font-bold font-mono" style={{ color: approved ? '#065f46' : '#7f1d1d' }}>
                        {entry.decision.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs font-mono leading-relaxed" style={{ color: approved ? '#065f46' : '#7f1d1d' }}>
                      {entry.reason}
                    </div>
                  </div>
                </div>

                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § II · Constitutional state */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § II · Constitutional State
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Continuity (C)',   value: entry.c.toFixed(3) },
                      { label: 'Reciprocity (R)',  value: entry.r.toFixed(3) },
                      { label: 'Sovereignty (S)',  value: entry.s.toFixed(3) },
                      { label: 'M = min(C,R,S)',   value: entry.m.toFixed(3) },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-lg p-3" style={{ background: '#e8e0cc', border: '1px solid #d4b896' }}>
                        <div className="text-xs font-mono mb-1" style={{ color: '#8b6914' }}>{label}</div>
                        <div className="text-sm font-bold font-mono" style={{ color: '#1a1209' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                {/* § III · Call record */}
                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § III · Call Record
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Tool', value: entry.tool_name },
                      { label: 'Risk level', value: entry.risk_level },
                      { label: 'Session', value: entry.session_id ? entry.session_id.slice(0, 28) + (entry.session_id.length > 28 ? '...' : '') : 'N/A' },
                      { label: 'Sigma violation', value: entry.sigma_viol.toFixed(4) },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded p-2.5 font-mono text-xs" style={{ background: '#e8e0cc', border: '1px solid #d4b896' }}>
                        <span className="mr-2" style={{ color: '#8b6914' }}>{label}:</span>
                        <span className="break-all" style={{ color: '#1a1209' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                <div className="px-4 sm:px-8 py-5 border-b" style={{ borderColor: '#d4b896' }}>
                  <div className="text-xs font-mono font-bold tracking-widest uppercase mb-3" style={{ color: '#8b6914' }}>
                    § IV · Timestamp
                  </div>
                  <div className="text-sm font-mono" style={{ color: '#1a1209' }}>
                    {entry.timestamp ? new Date(entry.timestamp).toISOString() : 'N/A'}
                  </div>
                </div>

                <div className="h-0.5 mx-4 sm:mx-8" style={{ background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

                <div className="px-4 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono" style={{ color: '#8b6914' }}>
                      This receipt records a tool call scored independently of the
                      <br />requesting agent&rsquo;s own judgment.
                    </div>
                    <div className="flex gap-3 mt-3">
                      <Link href="/constitution" className="text-xs font-mono transition-colors hover:underline" style={{ color: '#c9a84c' }}>
                        View Constitution ↗
                      </Link>
                      <Link href="/audit" className="text-xs font-mono transition-colors hover:underline" style={{ color: '#3b82f6' }}>
                        Audit Log ↗
                      </Link>
                    </div>
                  </div>
                  <div className="flex-shrink-0 px-5 py-3 rounded-xl border-2 text-center rotate-[-3deg]"
                    style={{
                      borderColor: approved ? '#166534' : '#7f1d1d',
                      background: approved ? 'rgba(22,101,52,0.06)' : 'rgba(127,29,29,0.06)',
                      color: approved ? '#166534' : '#7f1d1d',
                    }}>
                    <div className="text-xs font-black tracking-widest font-mono leading-tight">
                      {approved ? 'CONSTITUTIONALLY\nAPPROVED' : 'CONSTITUTIONALLY\nDENIED'}
                    </div>
                    <div className="text-xs font-mono mt-1" style={{ opacity: 0.7 }}>Tool-Call Governor</div>
                  </div>
                </div>

                <div className="px-4 sm:px-8 py-3 text-center border-t" style={{ borderColor: '#d4b896', background: '#ede8dc' }}>
                  <div className="text-xs font-mono" style={{ color: '#a07830' }}>
                    © 2026 Lex Intelligence Systems · Emmanuel King · Lagos, Nigeria
                    <br />doi.org/10.5281/zenodo.18944243 · Agentic Governance Layer · C+R+S=1
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      </main>
    </>
  );
}
