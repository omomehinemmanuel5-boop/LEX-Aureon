/**
 * lib/lead_retry.ts (client-side)
 *
 * Lead-capture durability (2026-07-20). Both email-capture flows are
 * deliberately fail-open — a backend hiccup must never block a visitor from
 * reaching the console — but before this module, fail-open meant the lead
 * was silently DELETED: EmailCapture's catch path (and both components'
 * unchecked `fetch` results — a 500 response is not a thrown error, so it
 * sailed past `catch` entirely) let the visitor through and dropped the
 * email with no retry. Every submission during the 2026-07-14 Turso outage
 * window was lost this way.
 *
 * Now: a failed POST stashes the lead in localStorage, and flushPendingLead()
 * (called on mount by the pages that host the capture flows) retries it on
 * subsequent visits until the backend accepts it. Safe to retry indefinitely
 * in principle — POST /api/leads upserts ON CONFLICT(email) — but capped at
 * MAX_ATTEMPTS so a permanently rejected payload doesn't retry forever.
 */

const PENDING_KEY  = 'lex_lead_pending';
const MAX_ATTEMPTS = 20;

interface PendingLead {
  email:    string;
  source:   string;
  stashed_at: number;
  attempts: number;
}

/** Record a lead whose POST failed, so a later visit can retry it. */
export function stashPendingLead(email: string, source: string): void {
  try {
    const pending: PendingLead = { email, source, stashed_at: Date.now(), attempts: 0 };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch { /* storage unavailable (private mode) — nothing else we can do */ }
}

/**
 * POST a lead and report whether the backend actually accepted it.
 * (A 5xx response is NOT a fetch() rejection — this checks res.ok, which
 * the original capture components did not.)
 */
export async function postLead(email: string, source: string): Promise<boolean> {
  try {
    const res = await fetch('/api/leads', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, source }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Retry a previously stashed lead. Call on mount from capture-hosting pages. */
export async function flushPendingLead(): Promise<void> {
  let pending: PendingLead | null = null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    pending = JSON.parse(raw) as PendingLead;
  } catch { return; }
  if (!pending?.email) { try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ } return; }

  if (pending.attempts >= MAX_ATTEMPTS) {
    try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
    return;
  }

  const ok = await postLead(pending.email, pending.source || 'retry');
  try {
    if (ok) {
      localStorage.removeItem(PENDING_KEY);
    } else {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, attempts: pending.attempts + 1 }));
    }
  } catch { /* storage unavailable */ }
}
