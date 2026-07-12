/**
 * lib/design_journal.ts
 *
 * A record of WHY, not just WHAT — separate from tool_receipts (which scores
 * individual tool-call actions) and praxis_receipts (which scores individual
 * governed turns). This table captures the reasoning behind significant
 * design decisions as they happen: what changed, why, what evidence
 * motivated it, and a reference to the real commit.
 *
 * Added 2026-07-11, deliberately scoped: this is NOT a step toward
 * self-awareness. It's the difference between a system that can only
 * reconstruct its own history by inference (the way any LLM, including the
 * one that built this, has to reason about its own training after the
 * fact) and one that can cite actual stored evidence for why it is the way
 * it is. Self-evidence, not self-awareness — narrateOrigin() below only
 * ever synthesizes from what's actually in this table. It never invents a
 * reason that wasn't logged, and if nothing relevant was logged, it says so
 * plainly rather than filling the gap with a plausible-sounding guess.
 */

import { getClient } from './db';

export interface DesignDecision {
  decision:   string; // what changed
  reasoning:  string; // why, in plain language
  evidence?:  string; // what observation/data motivated it, if any
  commit_sha?: string;
  component:  string; // which subsystem, e.g. 'tool_crs', 'audit', 'self_reflection'
}

export interface DesignDecisionRow extends DesignDecision {
  id: number;
  created_at: string;
}

export async function ensureDesignJournalTable(): Promise<void> {
  try {
    const db = getClient();
    await db.execute(`CREATE TABLE IF NOT EXISTS design_decisions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      decision    TEXT NOT NULL,
      reasoning   TEXT NOT NULL,
      evidence    TEXT,
      commit_sha  TEXT,
      component   TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch (e) {
    console.error('ensureDesignJournalTable error:', e);
  }
}

export async function logDecision(d: DesignDecision): Promise<void> {
  await ensureDesignJournalTable();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO design_decisions (decision, reasoning, evidence, commit_sha, component)
          VALUES (?, ?, ?, ?, ?)`,
    args: [d.decision, d.reasoning, d.evidence ?? null, d.commit_sha ?? null, d.component],
  });
}

export async function getDecisions(component?: string, limit = 30): Promise<DesignDecisionRow[]> {
  await ensureDesignJournalTable();
  const db = getClient();
  const res = component
    ? await db.execute({ sql: `SELECT * FROM design_decisions WHERE component = ? ORDER BY id DESC LIMIT ?`, args: [component, limit] })
    : await db.execute({ sql: `SELECT * FROM design_decisions ORDER BY id DESC LIMIT ?`, args: [limit] });
  return res.rows.map(r => ({
    id: Number(r.id),
    decision: String(r.decision),
    reasoning: String(r.reasoning),
    evidence: r.evidence ? String(r.evidence) : undefined,
    commit_sha: r.commit_sha ? String(r.commit_sha) : undefined,
    component: String(r.component),
    created_at: String(r.created_at),
  }));
}

/**
 * Synthesizes a plain-language answer to "why are you the way you are"
 * (optionally scoped to one component) using ONLY rows actually stored in
 * design_decisions. If nothing relevant exists, says so explicitly rather
 * than inventing a plausible-sounding reason.
 */
export async function narrateOrigin(component?: string): Promise<string> {
  const rows = await getDecisions(component, 20);
  if (!rows.length) {
    return component
      ? `No logged design decisions for component "${component}" yet. Nothing to narrate from evidence -- would have to guess, and this deliberately doesn't.`
      : `No design decisions logged yet.`;
  }

  const lines = [
    component ? `── Origin, component: ${component} ──` : `── Origin (all components, most recent first) ──`,
    ``,
  ];
  for (const r of rows) {
    lines.push(`[${r.created_at}] ${r.component}: ${r.decision}`);
    lines.push(`  why: ${r.reasoning}`);
    if (r.evidence) lines.push(`  evidence: ${r.evidence}`);
    if (r.commit_sha) lines.push(`  commit: ${r.commit_sha}`);
    lines.push('');
  }
  return lines.join('\n');
}
