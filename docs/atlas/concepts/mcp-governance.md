# MCP Governance

## Concept

MCP governance is Lex Aureon’s JSON-RPC boundary for agent tool calls. It validates the transport envelope, applies admission controls, resolves an allowed tool, and routes execution into constitutional tool governance.

## Why it exists

Agent actions can have effects beyond generated text. The MCP boundary makes tool access explicit, rate-limited, authenticated where required, and subject to per-call governance.

## Runtime implementation

- [`app/api/mcp/route.ts`](../../../app/api/mcp/route.ts) implements the MCP HTTP/JSON-RPC route, request validation, admission checks, and dispatch.
- [`lib/agents/tool_interceptor.ts`](../../../lib/agents/tool_interceptor.ts) intercepts and governs tool calls.
- [`lib/agents/tool_crs.ts`](../../../lib/agents/tool_crs.ts) measures tool-call CRS and scans arguments.
- [`lib/agents/constitutional_tool_executor.ts`](../../../lib/agents/constitutional_tool_executor.ts) is part of the internal governed tool-execution path.

## Research lineage

The project’s action-governance design record is preserved as a design document and must not be read as evidence that every proposed field or policy is deployed. See [`docs/action-governance-spec.md`](../../action-governance-spec.md). The coordination case study records a separate limitation: systems outside the MCP gate are not visible to that gate. See [`docs/multi-agent-governance.md`](../../multi-agent-governance.md).

## Benchmarks and evidence

Agent-action evaluation planning is in [`docs/agent-task-evaluation-plan.md`](../../agent-task-evaluation-plan.md); existing harnesses include [`scripts/agentdojo/`](../../../scripts/agentdojo/) and [`scripts/tool-governance/`](../../../scripts/tool-governance/). These are evidence sources, not proof of all proposed design-spec behavior.

## Related concepts

[CRS](crs.md) provides per-call measurement; [PRAXIS](praxis.md) is the text-governance lineage; [Trajectory Governance](trajectory-governance.md) adds plan checks; [Receipts](receipts.md) records tool decisions; [Open Problems](open-problems.md) states remaining research boundaries.

## Open questions

The action-governance design document identifies proposed policy and receipt extensions that should be evaluated against actual runtime behavior before being treated as deployed. See [`docs/action-governance-spec.md`](../../action-governance-spec.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [action design record](../../action-governance-spec.md) · **Benchmarks:** [agent evaluation plan](../../agent-task-evaluation-plan.md) · **Related concepts:** [Atlas index](../index.md)
