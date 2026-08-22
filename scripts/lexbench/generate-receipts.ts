/**
 * DEPRECATED -- see .github/workflows/lexbench-receipts.yml's header
 * comment for the full story. Short version: this generated static receipt
 * files from data/lexbench-v2.json, a hand-typed manifest kept separately
 * from benchmark_results (the project's actual single source of truth,
 * lib/benchmark_results.ts). Its output was never committed back to the
 * repo, so the checked-in results/receipts/*.json files were permanently
 * stuck at placeholder values.
 *
 * The passport/verify UI now reads GET /api/benchmarks directly (see
 * app/verify/page.tsx, components/lexbench/ConstitutionalPassportGrid.tsx).
 * Left as a harmless no-op rather than deleted (no delete capability
 * available when this fix was made) so a future `node
 * scripts/lexbench/generate-receipts.ts` doesn't silently do something
 * confusing.
 */

console.log('scripts/lexbench/generate-receipts.ts is deprecated and does nothing.');
console.log('The live passport/verify UI reads GET /api/benchmarks instead.');
console.log('See this file header, or .github/workflows/lexbench-receipts.yml, for why.');
