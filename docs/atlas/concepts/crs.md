# CRS

## Concept

CRS is Lex Aureon’s constitutional state: **Continuity**, **Reciprocity**, and **Sovereignty**. The governing invariant is `C + R + S = 1`; the minimum component is the stability margin `M(x)`.

## Why it exists

The system needs an inspectable state for identity preservation, evidence-grounded behavior, and resistance to manipulation, rather than a single opaque safety score.

## Runtime implementation

- [`lib/constitution.ts`](../../../lib/constitution.ts) defines constitutional constants and simplex assertions.
- [`lib/sovereign_kernel.ts`](../../../lib/sovereign_kernel.ts) maintains the kernel state and runs a governed cycle.
- [`lib/agents/tool_crs.ts`](../../../lib/agents/tool_crs.ts) measures CRS for governed tool calls.
- [`app/api/lex/govern/route.ts`](../../../app/api/lex/govern/route.ts) exposes the text-governance entry point.

## Research lineage

The repository overview defines the C/R/S state and its roles; the research tracker records the remaining analytical boundary around multi-pillar stability. See [`README.md`](../../../README.md) and [`research/open-problems.md`](../../../research/open-problems.md).

## Benchmarks and evidence

CRS measurements appear in the frozen PRAXIS empirical record, while broader benchmark publication is served from the benchmark-results store. See [`research/empirical-results.md`](../../../research/empirical-results.md), [`scripts/lexbench/`](../../../scripts/lexbench/), and [`app/api/benchmarks/route.ts`](../../../app/api/benchmarks/route.ts).

## Related concepts

[PRAXIS](praxis.md) applies CRS to governed text turns; [Trajectory Governance](trajectory-governance.md) uses plan constraints for actions; [MCP Governance](mcp-governance.md) uses tool-call CRS; [Receipts](receipts.md) persist decision evidence; [Open Problems](open-problems.md) records proof boundaries.

## Open questions

The global analytical Lyapunov proof for simultaneous multi-pillar violations remains open. See [`research/open-problems.md`](../../../research/open-problems.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [tracker](../../../research/open-problems.md) · **Benchmarks:** [LexBench](../../../LEXBENCH_README.md) · **Related concepts:** [Atlas index](../index.md)
