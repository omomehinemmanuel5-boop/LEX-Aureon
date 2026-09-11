# Lex Atlas Intellectual Timeline

| Stage | Evidence | What the repository supports |
|---|---|---|
| Early CRS | [`README.md`](../../README.md); [`lib/constitution.ts`](../../lib/constitution.ts) | The project defines C/R/S and enforces the simplex invariant in code. |
| PRAXIS | [`lib/praxis.ts`](../../lib/praxis.ts); [`lib/governance_service.ts`](../../lib/governance_service.ts); [`research/empirical-results.md`](../../research/empirical-results.md) | PRAXIS helpers and the governed orchestration path exist; empirical records are frozen separately from proof claims. |
| Receipts | [`lib/kernel_bridge.ts`](../../lib/kernel_bridge.ts); [`app/api/audits/verify/route.ts`](../../app/api/audits/verify/route.ts); [`docs/api.md`](../api.md) | Kernel receipts are persisted and have verification/export documentation. |
| Trajectory | [`lib/agents/trajectory_governance.ts`](../../lib/agents/trajectory_governance.ts); [`docs/agent-trajectory-governance.md`](../agent-trajectory-governance.md) | Plan-level authorization and reconciliation are implemented as an additional layer over tool authorization. |
| MCP | [`app/api/mcp/route.ts`](../../app/api/mcp/route.ts); [`lib/agents/tool_interceptor.ts`](../../lib/agents/tool_interceptor.ts); [`lib/agents/tool_crs.ts`](../../lib/agents/tool_crs.ts) | MCP transport and governed tool-call handling are deployed code paths. |

## Reading the timeline

This is a dependency-oriented timeline, not a claim that all ideas were first introduced on the dates of their current files. For dated project history, use the changelog in [`AGENTS.md`](../../AGENTS.md) and the route history in [`docs/architecture/govern-route-history.md`](../architecture/govern-route-history.md). Retired formulations are preserved in the [withdrawn-proofs archive](archives/withdrawn-proofs.md).

**Implementation:** [implementation map](implementation-map.md) · **Research:** [open-problem tracker](../../research/open-problems.md) · **Benchmarks:** [empirical record](../../research/empirical-results.md) · **Related concepts:** [Atlas index](index.md)
