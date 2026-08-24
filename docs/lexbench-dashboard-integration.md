# LexBench Dashboard Integration

Mount `components/lexbench/LexBenchV2Dashboard.tsx` on the landing page after the simulator.

Fix (2026-08-23): this component now reads `GET /api/benchmarks` — the same
single source of truth as `/benchmarks` and the passport UI (see
`lib/benchmark_results.ts`). It previously read `data/lexbench-v2.json`
directly, with this doc claiming that was "intentional... so benchmark
updates propagate automatically" — that reasoning was incorrect: a static
checked-in JSON file does not propagate anything automatically, it only
changes when someone hand-edits it. Caught by the CI regression guard
(`scripts/ci/check-no-static-receipts.sh`) before this was ever mounted, so
no user saw stale numbers from it. Still not mounted anywhere as of this
note — mounting on the landing page is still accurate guidance, just note
that decision should go through the same review the rest of the landing
page copy gets, since it's a new, visible section.