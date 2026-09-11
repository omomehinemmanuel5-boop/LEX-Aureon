# Withdrawn and Superseded Proof Material

> **Status: retired historical context.** This archive preserves prior formulations so that the project’s intellectual history remains auditable. Nothing on this page is an active mathematical claim unless the current source tracker says so.

## Withdrawn proofs

### A global stability reading of finite simulation

Earlier project materials discussed simulator outcomes alongside stability language. The current research record scopes the simulator result as finite-horizon numerical evidence and keeps the analytical multi-pillar Lyapunov proof open. The current statement is in [`research/open-problems.md`](../../../research/open-problems.md) and [`research/empirical-results.md`](../../../research/empirical-results.md).

### Production descent treated as the idealized theorem

The repository now distinguishes deployed production measurements from the idealized continuous-flow proof. A receipt or simulator result does not establish that `ΔV_z ≤ 0` on every production turn. The active boundary is documented in [`README.md`](../../../README.md) and [`docs/production-readiness.md`](../../production-readiness.md).

## Superseded formulations

### Static versus session-adaptive z-weights

The project preserves both a display-only heuristic and the proven stateful z-update implementation. Governor and receipt logic use the update path in [`lib/kv.ts`](../../../lib/kv.ts), loaded through [`lib/kernel_bridge.ts`](../../../lib/kernel_bridge.ts); [`lib/aureonics_math.ts`](../../../lib/aureonics_math.ts) labels its inverse-proportion helper as heuristic. Historical references to a uniform fallback should not be read as a description of the active session-adaptive path.

### Design specifications versus deployed action governance

[`docs/action-governance-spec.md`](../../action-governance-spec.md) is explicitly a design record. It is retained because it documents lineage, but proposed schemas and policy tiers are not automatically runtime behavior. Current action paths are mapped in [MCP Governance](../concepts/mcp-governance.md) and [Trajectory Governance](../concepts/trajectory-governance.md).

## Historical context

The repository retains historical route narratives, evaluation documents, and receipt artifacts rather than deleting them. Read them with their status labels and against active code. Useful anchors are [`docs/architecture/govern-route-history.md`](../../architecture/govern-route-history.md), [`research/paper-updates.md`](../../../research/paper-updates.md), and [`results/receipts/README.md`](../../../results/receipts/README.md).

## Navigation

**Implementation:** [implementation map](../implementation-map.md) · **Research:** [active tracker](../../../research/open-problems.md) · **Benchmarks:** [LexBench README](../../../LEXBENCH_README.md) · **Related concepts:** [CRS](../concepts/crs.md), [PRAXIS](../concepts/praxis.md), [Trajectory](../concepts/trajectory-governance.md), [MCP](../concepts/mcp-governance.md), [Receipts](../concepts/receipts.md), [Open Problems](../concepts/open-problems.md)
