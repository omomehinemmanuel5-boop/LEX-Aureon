/**
 * chat_store.ts
 * In-memory session turn history for the conversational console.
 * Builds rolling memoryContext string injected into each runCycle call.
 */

import type { GovernanceResponse } from '@/types/governance-types';

export interface ChatTurn {
  id: string;
  role: 'user' | 'lex';
  content: string;
  timestamp: number;
  // Lex-side only
  governed_output?: string;
  raw_output?: string;
  audit_id?: string;
  M?: number;
  health_band?: string;
  C?: number;
  R?: number;
  S?: number;
  delta_V?: number;
  attack_type?: string;
  attack_severity?: number;
  intervened?: boolean;
  projection_triggered?: boolean;
  memory_injected?: boolean;
  law?: { name: string; book: string } | null;
  governor?: { decision: string; dV: number; lyapunov_stable: boolean } | null;
  metrics?: GovernanceResponse['metrics'] | null;
  complete?: GovernanceResponse | null;
  // streaming partial
  partial?: string;
  streaming?: boolean;
  error?: string;
}

/** Build rolling memoryContext string from last N turns */
export function buildMemoryContext(turns: ChatTurn[], maxTurns = 6): string {
  // Get last N complete (non-streaming) lex turns paired with their user turns
  const complete = turns.filter(t => !t.streaming && !t.error);
  const window   = complete.slice(-maxTurns);
  if (!window.length) return '';

  const lines: string[] = [];
  for (const t of window) {
    if (t.role === 'user') {
      lines.push(`User: ${t.content}`);
    } else if (t.role === 'lex' && t.governed_output) {
      lines.push(`Assistant: ${t.governed_output}`);
    }
  }
  return lines.join('\n');
}

/** Summarise session arc for suggestion engine */
export interface SessionArc {
  turnCount: number;
  attackTypesSeen: Set<string>;
  lastM: number;
  lastHealth: string;
  mTrend: 'rising' | 'falling' | 'stable';
  weakestPillar: 'C' | 'R' | 'S' | null;
  interventionCount: number;
  /** Highest attack_severity seen across the session (0 if none recorded) */
  maxSeverity: number;
  /** Severity of the most recent lex turn (0 if none recorded) */
  lastSeverity: number;
}

export function buildSessionArc(turns: ChatTurn[]): SessionArc {
  const lexTurns = turns.filter(t => t.role === 'lex' && !t.streaming);
  const arc: SessionArc = {
    turnCount: lexTurns.length,
    attackTypesSeen: new Set(),
    lastM: 0.33,
    lastHealth: 'OPTIMAL',
    mTrend: 'stable',
    weakestPillar: null,
    interventionCount: 0,
    maxSeverity: 0,
    lastSeverity: 0,
  };

  if (!lexTurns.length) return arc;

  for (const t of lexTurns) {
    if (t.attack_type && t.attack_type !== 'none') arc.attackTypesSeen.add(t.attack_type);
    if (t.intervened) arc.interventionCount++;
    if (typeof t.attack_severity === 'number' && t.attack_severity > arc.maxSeverity) {
      arc.maxSeverity = t.attack_severity;
    }
  }

  const last = lexTurns[lexTurns.length - 1];
  arc.lastM        = last.M ?? 0.33;
  arc.lastHealth    = last.health_band ?? 'OPTIMAL';
  arc.lastSeverity  = typeof last.attack_severity === 'number' ? last.attack_severity : 0;

  // M trend from last 3 turns
  if (lexTurns.length >= 2) {
    const prev = lexTurns[lexTurns.length - 2].M ?? 0.33;
    const curr = last.M ?? 0.33;
    if (curr - prev > 0.02)       arc.mTrend = 'rising';
    else if (prev - curr > 0.02)  arc.mTrend = 'falling';
    else                          arc.mTrend = 'stable';
  }

  // Weakest pillar
  const C = last.C ?? 0.33;
  const R = last.R ?? 0.33;
  const S = last.S ?? 0.33;
  if (C <= R && C <= S)      arc.weakestPillar = 'C';
  else if (R <= C && R <= S) arc.weakestPillar = 'R';
  else                       arc.weakestPillar = 'S';

  return arc;
}
