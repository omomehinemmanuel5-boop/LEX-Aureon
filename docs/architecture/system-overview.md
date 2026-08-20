# Lex Aureon system overview

## Request flow

1. A client sends a prompt to the Next.js route layer.
2. The route applies body-size, field, API-key, and IP-rate-limit checks.
3. lib/governance_service.ts coordinates the governance pipeline.
4. The governor classifies risk, maps the prompt into the constitutional simplex, updates adaptive z-weights, chooses an intervention, and produces a response.
5. The receipt layer persists an append-only audit record with hashes and state values.
6. Public audit and verification routes expose only fields intended for external inspection.

## Main boundaries

- HTTP boundary: parsing, validation, authentication, rate limiting, and safe error formatting.
- Governance boundary: constitutional measurement and intervention decisions.
- Persistence boundary: Turso-backed memories, calibration data, and audit receipts.
- Evaluation boundary: benchmark runners and scoring scripts, which must not be confused with production proof.

## Design invariants

- C + R + S = 1 remains enforced.
- Audit receipts are append-only and independently verifiable.
- Internal provider, database, and stack details are logged server-side rather than exposed to anonymous users.
- Numerical certificates are labeled as finite-horizon seeded evidence.
- The multi-pillar global Lyapunov proof remains explicitly open until analytically closed.

## Operational guidance

Keep expensive benchmarks separate from the fast application quality gate. Pin evaluation results to a commit, dataset, model, and scoring configuration so they can be reproduced.
