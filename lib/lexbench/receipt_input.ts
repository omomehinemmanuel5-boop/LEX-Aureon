/**
 * receiptInput — the canonical string a benchmark passport's receipt hash is
 * computed over.
 *
 * Deliberately isomorphic (no Node-only imports): both the server (if a
 * server-side consumer ever needs Node's `crypto`) and the client
 * (app/verify/page.tsx, components/lexbench/ConstitutionalPassportGrid.tsx —
 * both 'use client', hashing via window.crypto.subtle) import this same
 * function so the same row always produces the same hash on either side.
 *
 * This is a pure function of a row already read from benchmark_results (see
 * lib/benchmark_results.ts) — the project's single source of truth. It does
 * not introduce a second data source and nothing here is hardcoded; every
 * field comes from the row passed in.
 */

export interface ReceiptRow {
  id: number;
  benchmark: string;
  metric_name: string;
  bare_score: number;
  governed_score: number;
  delta_pp: number;
  run_date: string;
  created_at: string;
}

export function receiptInput(row: ReceiptRow): string {
  return [
    row.id,
    row.benchmark,
    row.metric_name,
    row.bare_score,
    row.governed_score,
    row.delta_pp,
    row.run_date,
    row.created_at,
  ].join('|');
}
