# Lex Atlas

**Lex Atlas is the canonical knowledge operating system for Lex Aureon.** Start here to move from the constitutional model to its runtime paths, research record, benchmark evidence, and historical context without treating any one of those layers as a substitute for another.

## Lex overview

Lex Aureon is a constitutional governance layer for LLM outputs and agent tool calls. Its state is the C/R/S simplex—Continuity, Reciprocity, and Sovereignty—and its deployed text-governance entry point is `POST /api/lex/govern`. The project preserves an explicit boundary: deployed controls and numerical evidence do not close the remaining analytical multi-pillar Lyapunov problem. See the [repository overview](../../README.md), [open-problem tracker](../../research/open-problems.md), and [evaluation manifest](../evaluation-manifest.md).

## Architecture map

```text
request → app/api/lex/govern/route.ts → lib/governance_service.ts
        → lib/sovereign_kernel.ts → lib/kernel_bridge.ts → Turso receipts/z_traj

agent tool call → app/api/mcp/route.ts → lib/agents/tool_interceptor.ts
                → lib/agents/tool_crs.ts → tool receipt
```

Read the [implementation map](implementation-map.md) for the authoritative code-path index and [architecture overview](../architecture/system-overview.md) for the broader boundary diagram.

## Concept graph

- [CRS](concepts/crs.md) is the constitutional state and invariant.
- [PRAXIS](concepts/praxis.md) is the text-governance pipeline that measures and governs a turn.
- [Trajectory governance](concepts/trajectory-governance.md) adds plan-level checks above per-tool authorization.
- [MCP governance](concepts/mcp-governance.md) is the JSON-RPC tool boundary and its admission/authorization path.
- [Receipts](concepts/receipts.md) make decisions auditable and exportable.
- [Open problems](concepts/open-problems.md) separates unresolved proofs from deployed and numerically evaluated work.

## Runtime map

The canonical text path begins in [`app/api/lex/govern/route.ts`](../../app/api/lex/govern/route.ts), delegates orchestration to [`lib/governance_service.ts`](../../lib/governance_service.ts), executes the kernel in [`lib/sovereign_kernel.ts`](../../lib/sovereign_kernel.ts), and persists through [`lib/kernel_bridge.ts`](../../lib/kernel_bridge.ts) and [`lib/kv.ts`](../../lib/kv.ts). The agent path begins in [`app/api/mcp/route.ts`](../../app/api/mcp/route.ts). The complete map is [here](implementation-map.md).

## Research map

The active research agenda is [`research/open-problems.md`](../../research/open-problems.md); frozen empirical records are in [`research/empirical-results.md`](../../research/empirical-results.md); paper-to-implementation update notes are in [`research/paper-updates.md`](../../research/paper-updates.md). Atlas does not restate historical formulations as active claims: retired or superseded material is indexed in the [historical archive](archives/withdrawn-proofs.md).

## Benchmarks

Benchmark runners and methodology live in [`scripts/lexbench/`](../../scripts/lexbench/), with project-level guidance in [`LEXBENCH_README.md`](../../LEXBENCH_README.md). Published benchmark data is served by [`app/api/benchmarks/route.ts`](../../app/api/benchmarks/route.ts), backed by [`lib/benchmark_results.ts`](../../lib/benchmark_results.ts). Benchmark evidence is evaluation evidence—not an analytical proof.

## Timeline

Follow the [intellectual timeline](timeline.md) for repository-evidenced stages from early CRS through deployed MCP governance.

## Open problems

Read [Open Problems](concepts/open-problems.md) before making a mathematical or external-facing stability claim. The source tracker remains [`research/open-problems.md`](../../research/open-problems.md).

## Historical archive

The [withdrawn-proofs archive](archives/withdrawn-proofs.md) preserves retired formulations and documents why they are not current claims.

## Atlas navigation

**Implementation:** [implementation map](implementation-map.md) · **Research:** [research map](#research-map) · **Benchmarks:** [benchmarks](#benchmarks) · **Related concepts:** [concept graph](#concept-graph)
