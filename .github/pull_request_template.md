## What changed

<!-- Brief description -->

## Data source checklist

This project has a documented, hard-won rule (see `ARCHITECTURE_AUDIT.md` at
the repo root, and `lib/benchmark_results.ts`'s header comment): **no
hardcoded or placeholder values in anything users see.** Every figure, badge,
or state shown in the UI should trace back to a real, live query — not a
static file, a manifest checked in by hand, or a value someone typed in
"for now." This class of bug has recurred multiple times in this codebase's
history; each recurrence is documented in `ARCHITECTURE_AUDIT.md`.

Before requesting review, confirm:

- [ ] Every number/badge/status this PR renders is derived from a live
      query or API response, not a literal in the component.
- [ ] If a value can be `null` / unavailable / stale, the UI shows that
      honestly (a loading or "no data yet" state) rather than a fallback
      number that looks real.
- [ ] If this PR adds a new static JSON/data file as a UI data source,
      there's a clear reason a live query wasn't used instead, stated in
      the PR description.
- [ ] CI is green, including the "No deprecated static receipt sources"
      check (`scripts/ci/check-no-static-receipts.sh`).

## Verified vs. assumed

<!-- What did you actually check (read the code, ran it, queried the DB)
     vs. what are you assuming is true? Be explicit -- see this repo's
     commit history for the convention (e.g. lib/kernel_bridge.ts,
     app/api/lex/govern/stream/route.ts header comments). -->
