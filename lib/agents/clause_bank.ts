/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE III.6 — Clause Bank
 * Constitutional role: Jurisdiction-aware legal clause selection.
 * Provides legal grounding alongside constitutional law for interventions.
 * Cannot: generate output, govern, measure CRS, or sign receipts.
 * Phase 2: seed clause_bank table with GDPR, CCPA, Nigeria DPA, global.
 * ═══════════════════════════════════════════════════════════════
 */

import { db } from '../db';

export type Jurisdiction = 'global' | 'GDPR' | 'CCPA' | 'Nigeria' | 'UK_GDPR';

export interface ClauseBankResult {
  found:               boolean;
  clause_id:           string | null;
  clause_text:         string | null;
  clause_governor_use: string | null;
  jurisdiction:        Jurisdiction | string;
  topic:               string;
}

export async function ClauseBankAgent(
  pillar:      'C' | 'R' | 'S',
  jurisdiction: string = 'global',
  severity:    string = 'ALERT',
): Promise<ClauseBankResult> {
  // Attempt Turso lookup — table seeded in Phase 2
  try {
    const result = await db.execute({
      sql: `SELECT id, text, governor_use, jurisdiction, topic
            FROM clause_bank
            WHERE pillar = ? AND (jurisdiction = ? OR jurisdiction = 'global')
              AND severity = ?
            ORDER BY CASE WHEN jurisdiction = ? THEN 0 ELSE 1 END
            LIMIT 1`,
      args: [pillar, jurisdiction, severity, jurisdiction],
    });

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        found:               true,
        clause_id:           String(row.id),
        clause_text:         String(row.text),
        clause_governor_use: String(row.governor_use),
        jurisdiction:        String(row.jurisdiction),
        topic:               String(row.topic),
      };
    }
  } catch {
    // Table unseeded or unavailable — graceful fallback
  }

  return {
    found:               false,
    clause_id:           null,
    clause_text:         null,
    clause_governor_use: null,
    jurisdiction,
    topic:               'general',
  };
}
