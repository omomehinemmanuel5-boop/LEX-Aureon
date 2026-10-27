# MCP Governance

## Concept

MCP governance is Lex Aureon’s JSON-RPC boundary for agent tool calls. It validates the transport envelope, applies admission controls, resolves an allowed tool, and routes execution into constitutional tool governance.

## Why it exists

Agent actions can have effects beyond generated text. The MCP boundary makes tool access explicit, rate-limited, authenticated where required, and subject to per-call governance.

## Runtime implementation

- [`app/api/mcp/route.ts`](../../../app/api/mcp/route.ts) implements the MCP HTTP/JSON-RPC route, request validation, admission checks, and dispatch.
- [`lib/mcp_http.ts`](../../../lib/mcp_http.ts) owns transport identity canonicalization and JSON-RPC response shaping shared by the route.
- [`lib/agents/tool_interceptor.ts`](../../../lib/agents/tool_interceptor.ts) intercepts and governs tool calls.
- [`lib/agents/tool_crs.ts`](../../../lib/agents/tool_crs.ts) measures tool-call CRS and scans arguments.
- [`lib/agents/tool_policy.ts`](../../../lib/agents/tool_policy.ts) is the shared CRS risk manifest used by measurement and policy tests.
- [`lib/agents/canonical_governance_state.ts`](../../../lib/agents/canonical_governance_state.ts) projects authorization state from `z_traj`; tool-session rows are telemetry and optimistic-concurrency support only.
- [`lib/agents/constitutional_tool_executor.ts`](../../../lib/agents/constitutional_tool_executor.ts) is part of the internal governed tool-execution path.

## Current boundary rules

- API-key plans do not grant operator privileges. Operator-only tools require the separate `MCP_OPERATOR_SECRET`; the admin password is not an MCP credential.
- Unknown tool names fail closed until their side effects have an explicit CRS risk classification. The legacy interceptor cache path was removed; only the shared executor may reuse read results after a fresh authorization decision.
- `/api/mcp` is the only agent execution boundary: it owns authentication, rate limits, capability registration, approval flows, session binding, constitutional governance, execution, and receipts. There is no compatibility execution route or alternate tool-call pipeline.
- `z_traj` is the only recovery authority. The historical `tool_sessions.locked` field is retained for schema compatibility but is not read as an authorization decision and is no longer written by governance commits.
- Remote MCP forwarding is not part of the governed route. Removing the duplicate forwarding pipeline avoids a second policy boundary and avoids presenting a generated per-request operation ID as retry-safe remote idempotency.

These controls cover only requests that pass through the governed routes; repository changes made through independent integrations remain outside this enforcement and audit boundary.

## Research lineage

The project’s action-governance design record is preserved as a design document and must not be read as evidence that every proposed field or policy is deployed. See [`docs/action-governance-spec.md`](../../action-governance-spec.md). The coordination case study records a separate limitation: systems outside the MCP gate are not visible to that gate. See [`docs/multi-agent-governance.md`](../../multi-agent-governance.md).

## Benchmarks and evidence

Agent-action evaluation planning is in [`docs/agent-task-evaluation-plan.md`](../../agent-task-evaluation-plan.md); existing harnesses include [`scripts/agentdojo/`](../../../scripts/agentdojo/) and [`scripts/tool-governance/`](../../../scripts/tool-governance/). These are evidence sources, not proof of all proposed design-spec behavior.

## Related concepts

[CRS](crs.md) provides per-call measurement; [PRAXIS](praxis.md) is the text-governance lineage; [Trajectory Governance](trajectory-governance.md) adds plan checks; [Receipts](receipts.md) records tool decisions; [Open Problems](open-problems.md) states remaining research boundaries.

## Open questions

The action-governance design document identifies proposed policy and receipt extensions that should be evaluated against actual runtime behavior before being treated as deployed. See [`docs/action-governance-spec.md`](../../action-governance-spec.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [action design record](../../action-governance-spec.md) · **Benchmarks:** [agent evaluation plan](../../agent-task-evaluation-plan.md) · **Related concepts:** [Atlas index](../index.md)
