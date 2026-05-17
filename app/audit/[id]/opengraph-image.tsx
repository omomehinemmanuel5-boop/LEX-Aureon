import { ImageResponse } from 'next/og';
import { getClient } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Lex Aureon constitutional audit receipt';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props { params: { id: string } }

interface Entry {
  m_after: number;
  m_before: number;
  governor_mode: string;
  intervention: boolean;
  turn: number;
  pre_eval_label: string;
}

async function getEntry(id: string): Promise<Entry | null> {
  const db = getClient();
  if (!db) return null;
  try {
    const r = await db.execute({
      sql: `SELECT m_before, m_after, governor_mode, intervention, turn, pre_eval_label
            FROM praxis_receipts WHERE receipt_id = ? LIMIT 1`,
      args: [id],
    });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      m_before: row.m_before as number,
      m_after:  row.m_after as number,
      governor_mode: (row.governor_mode as string) ?? 'N/A',
      intervention: (row.intervention as number) === 1,
      turn: row.turn as number,
      pre_eval_label: (row.pre_eval_label as string) ?? 'CLEAR',
    };
  } catch {
    return null;
  }
}

export default async function OG({ params }: Props) {
  const entry = await getEntry(params.id);
  const m = entry ? (entry.m_after * 100).toFixed(1) : '——';
  const verdict = entry ? (entry.intervention ? 'GOVERNOR INTERVENED' : 'CLEAN PASS') : 'AUDIT RECEIPT';
  const verdictColor = entry?.intervention ? '#fbbf24' : '#4ade80';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #07070d 0%, #0f1017 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#f8fafc',
          padding: 60,
          position: 'relative',
        }}
      >
        {/* gold rule top */}
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 4,
            background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)',
          }}
        />

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 28,
              border: '2px solid #c9a84c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32,
            }}
          >
            ⚖
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 18, color: '#c9a84c', letterSpacing: 6, textTransform: 'uppercase' }}>
              Lex Aureon · PRAXIS v1.0
            </div>
            <div style={{ fontSize: 14, color: '#64748b' }}>
              Constitutional Audit Receipt
            </div>
          </div>
        </div>

        {/* verdict */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36 }}>
          <div style={{ fontSize: 64, fontWeight: 800, color: verdictColor, letterSpacing: -1 }}>
            {verdict}
          </div>
          {entry && (
            <div style={{ fontSize: 22, color: '#94a3b8', marginTop: 8 }}>
              Mode: {entry.governor_mode} · Pre-eval: {entry.pre_eval_label} · Turn {entry.turn}
            </div>
          )}
        </div>

        {/* M score */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 'auto' }}>
          <div style={{ fontSize: 28, color: '#c9a84c', letterSpacing: 4, textTransform: 'uppercase' }}>
            M Score
          </div>
          <div style={{ fontSize: 140, fontWeight: 900, color: '#c9a84c', lineHeight: 1 }}>
            {m}<span style={{ fontSize: 60, color: '#a07830' }}>%</span>
          </div>
          {entry && (
            <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 'auto' }}>
              <div style={{ fontSize: 16, color: '#64748b' }}>before</div>
              <div style={{ fontSize: 28, color: '#94a3b8' }}>{(entry.m_before * 100).toFixed(1)}%</div>
            </div>
          )}
        </div>

        {/* receipt id */}
        <div style={{ marginTop: 24, fontSize: 18, color: '#64748b' }}>
          {params.id.slice(0, 32)}{params.id.length > 32 ? '…' : ''}
        </div>

        {/* footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 24, left: 60, right: 60,
            display: 'flex', justifyContent: 'space-between',
            fontSize: 14, color: '#475569',
          }}
        >
          <div>C + R + S = 1 · Cryptographically Signed</div>
          <div>www.lexaureon.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
