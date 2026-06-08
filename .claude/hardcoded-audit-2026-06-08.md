# Hardcoded Values Audit — 2026-06-08

## FINDINGS

### CRITICAL (fixed)
1. **HeroTicker** — `useState<number>(0.226)` seeded a fake M=22.6% before API responded.
   - FIX: changed to `useState<number | null>(null)` — shows `—` until real API data arrives.
   - Rule: never show a made-up number in a system that claims mathematical traceability.

2. **LiveStatsBar** — `0.0%` ASR hardcoded as a string literal with no explanation.
   - FIX: extracted to named constants `PUBLISHED_ASR_PCT` and `PUBLISHED_PROMPTS` with
     a comment explaining it's the published benchmark result (920 prompts, 3 benchmarks),
     NOT a live inference stat. Update the constants when new benchmark runs ship.
   - Also added skeleton shimmer while API data loads (was showing nothing or stale zeros).

3. **ProofPanel simplex** — `<SimplexVisualizer c={0.28} r={0.41} s={0.31} />` had no label
   indicating it was a static example, not the live constitutional state.
   - FIX: label changed to "EXAMPLE STATE · identity attack scenario · post-CBF projection"
   - Patch documented in .claude/proof-panel-simplex-patch.md (apply manually to app/page.tsx)

### ACCEPTABLE (by design, documented)
- RedTeamSection CATEGORIES array — static prompt examples. These are real attack categories,
  not synthetic. Counts (85, 80, 75...) are internal test suite sizes. Clearly labeled
  "Internal Stress-Testing Suite · v2" and "Separate from published benchmark results".
- EnterpriseSection tests array — already fixed in previous session: labeled
  "Example results from production runs", not "Live".
- HarmBenchStrip benchmark data — static by design (published results don't change).
  Each entry has the year and prompt count. Correct.
- SimplexVisualizer default props (c=0.333, r=0.333, s=0.334) — centroid fallback.
  Appropriate default for when no props passed.
- AgenticSection step examples (C=0.71, R=0.22 etc.) — labeled as example pipeline trace.

## CLEAN (fully live from real APIs)
- GovernanceFeed → /api/audits/recent (polls every 8s)
- LiveStatsBar M/C/R/S/Governed Turns/Intercept Rate → /api/live-state + /api/audits/recent
- HeroTicker → /api/live-state (polls every 5s, now shows — until data arrives)
- /api/live-state → lib/db.getAggregateConstitutionalState() → z_traj table (real Turso)
- /api/audits/recent → lib/db.getRecentAudits() → praxis_receipts table (real Turso)
- lib/db.ts — no hardcoded fallbacks, no in-memory mocks, no silent failures.
  All reads throw or return null on failure. Single backend. Documented.

## RULE FOR FUTURE SESSIONS
Any number shown on the landing page must be one of:
  A) Fetched live from a real API route backed by Turso (M, C, R, S, total_runs, intercept_rate)
  B) A named constant with a code comment explaining its source (PUBLISHED_ASR_PCT)
  C) Clearly labeled as an example/scenario in the UI label text

No unnamed literals for metric values.
