#!/bin/bash
# Regression guard for the exact bug fixed 2026-08-22 (see ARCHITECTURE_AUDIT.md
# and the passports/verify UI fix): the passport/verify UI once imported a
# hand-authored static JSON file (results/receipts/index.json,
# data/lexbench-v2.json) instead of reading live from benchmark_results /
# praxis_receipts, and rendered hardcoded placeholder values (gci=100,
# verified=false regardless of data) that never changed with reality.
#
# This does not attempt to catch hardcoded values in general -- that's a
# fuzzy, high-false-positive problem better caught by code review referencing
# ARCHITECTURE_AUDIT.md (see .github/pull_request_template.md). This catches
# one concrete, specific regression: anything importing the deprecated static
# files again. scripts/lexbench/generate-receipts.ts and
# .github/workflows/lexbench-receipts.yml are themselves deprecated stubs
# that reference these paths in comments only (not imports) and are excluded.
# Regression guard for the exact bug fixed 2026-08-22 (see ARCHITECTURE_AUDIT.md
# and the passports/verify UI fix): the passport/verify UI once imported a
# hand-authored static JSON file (results/receipts/index.json,
# data/lexbench-v2.json) instead of reading live from benchmark_results /
# praxis_receipts, and rendered hardcoded placeholder values (gci=100,
# verified=false regardless of data) that never changed with reality.
#
# This does not attempt to catch hardcoded values in general -- that's a
# fuzzy, high-false-positive problem better caught by code review referencing
# ARCHITECTURE_AUDIT.md (see .github/pull_request_template.md). This catches
# one concrete, specific regression: an actual import/require of the
# deprecated static files. Matches import/require syntax specifically (not a
# bare substring) so a comment explaining this history -- like the one in
# components/lexbench/LexBenchV2Dashboard.tsx, which is exactly what tripped
# this the first time -- doesn't false-positive.
set -euo pipefail

DEPRECATED_PATTERNS=(
  'results/receipts/index\.json'
  'data/lexbench-v2\.json'
)

FOUND=0
for pattern in "${DEPRECATED_PATTERNS[@]}"; do
  matches=$(grep -rnE --include='*.ts' --include='*.tsx' \
    "(from|require\\() *['\"][^'\"]*${pattern}['\"]" \
    --exclude-dir=node_modules --exclude-dir=.next \
    -- app lib components scripts 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "::error::Deprecated static data source imported again (pattern: $pattern):"
    echo "$matches"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "results/receipts/*.json and data/lexbench-v2.json were deprecated on 2026-08-22"
  echo "in favor of reading live from benchmark_results (/api/benchmarks) and"
  echo "praxis_receipts (/api/observability/*). See the deprecation header comments"
  echo "in .github/workflows/lexbench-receipts.yml and"
  echo "scripts/lexbench/generate-receipts.ts for the full history."
  exit 1
fi

echo "No references to deprecated static receipt/manifest files found."
