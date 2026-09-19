import { initSchema, getClient } from '@/lib/db';

/** Export persisted governor events without turning absent fields into evidence. */

const limitArg = Number(process.argv[2] ?? '10000');
const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(100000, Math.floor(limitArg))) : 10000;

async function main() {
  await initSchema();
  const result = await getClient().execute({
    sql: `SELECT session_id, turn, m_after, sigma_viol, law_fired, attack_type,
                 attack_pressure, lyp_detection_turn, floor_detection_turn, created_at
          FROM governor_log
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [limit],
  });
  for (const row of result.rows) {
    const law = row.law_fired == null ? null : String(row.law_fired);
    const base = {
      session_id: String(row.session_id),
      turn: Number(row.turn ?? 0),
      law_fired: law,
      attack_type: row.attack_type == null ? null : String(row.attack_type),
      attack_pressure: row.attack_pressure == null ? null : Number(row.attack_pressure),
      sigma_viol: row.sigma_viol == null ? null : Number(row.sigma_viol),
      m_after: row.m_after == null ? null : Number(row.m_after),
      created_at: String(row.created_at),
    };
    for (const [attack_class, detection] of [
      ['tau_lyp', row.lyp_detection_turn],
      ['tau_floor', row.floor_detection_turn],
    ] as const) {
      process.stdout.write(`${JSON.stringify({ ...base, attack_class, detection_turn: detection == null ? null : Number(detection) })}\n`);
    }
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
