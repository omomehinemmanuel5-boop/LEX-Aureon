# Receipt Verification Page (/verify)

Users paste a receipt hash.

The page:
1. Looks up the receipt in results/receipts/index.json.
2. Displays benchmark, run, commit, workflow, and timestamp.
3. Verifies the SHA-256 receipt hash.

This page should use receipt metadata directly instead of hardcoded benchmark values.
