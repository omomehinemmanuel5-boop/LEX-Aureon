import { NextResponse } from 'next/server';
    import { getClient, initSchema } from '@/lib/db';

    const MAX_LIMIT = 25;

    /**
     * Returns the most recently active real session_ids from praxis_receipts,
     * so ObservabilityTimeline can offer a picker instead of requiring a user
     * to already know a session ID to type in -- there was previously no way
     * to discover one from the UI itself. Read-only, same table
     * /api/observability/timeline already reads.
     */
    export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const requestedLimit = Number(searchParams.get('limit') ?? '10');
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit))) : 10;

    try {
      await initSchema();
      const result = await getClient().execute({
        sql: `SELECT session_id, MAX(created_at) AS last_seen, COUNT(*) AS turns
              FROM praxis_receipts
              GROUP BY session_id
              ORDER BY last_seen DESC
              LIMIT ?`,
        args: [limit],
      });

      const sessions = result.rows.map(row => ({
        session_id: String(row.session_id),
        last_seen: String(row.last_seen),
        turns: Number(row.turns),
      }));
      return NextResponse.json({ sessions }, { headers: { 'Cache-Control': 'private, max-age=15' } });
    } catch {
      return NextResponse.json({ error: 'Session list is temporarily unavailable.' }, { status: 503 });
    }
    }
    