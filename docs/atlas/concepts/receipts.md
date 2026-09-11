# Receipts

## Concept

Receipts are the audit records associated with governed text decisions and governed tool calls. They bind decision data to hashes and, where available, signing metadata; they are not claims that every underlying model behavior or theorem has been independently proven.

## Why it exists

Governance must be inspectable after the response or action. Receipts provide a durable record of constitutional state, intervention information, and persistence status for audit and verification.

## Runtime implementation

- [`lib/kernel_bridge.ts`](../../../lib/kernel_bridge.ts) constructs, signs where configured, and persists kernel receipts.
- [`lib/kv.ts`](../../../lib/kv.ts) owns core receipt and trajectory persistence.
- [`app/api/audits/verify/route.ts`](../../../app/api/audits/verify/route.ts) verifies text-receipt signatures.
- [`app/api/audits/[id]/export/route.ts`](../../../app/api/audits/[id]/export/route.ts) exports a canonical audit bundle.
- [`lib/agents/tool_interceptor.ts`](../../../lib/agents/tool_interceptor.ts) writes governed tool-call receipts.

## Research lineage

Receipt fields have evolved with the deployed z-weighted certificate and signing-key metadata. The research update notes and API documentation state the verification boundary, including the classification of historical fallback-key material. See [`research/paper-updates.md`](../../../research/paper-updates.md) and [`docs/api.md`](../../api.md).

## Benchmarks and evidence

LexBench has a separate benchmark-receipt helper in [`lib/lexbench/receipt.ts`](../../../lib/lexbench/receipt.ts) and runner infrastructure in [`scripts/lexbench/`](../../../scripts/lexbench/). Historical static benchmark-receipt material remains documented in [`results/receipts/README.md`](../../../results/receipts/README.md); it is not the source for the live benchmark API.

## Related concepts

[CRS](crs.md) supplies receipt state; [PRAXIS](praxis.md) creates governed text decisions; [Trajectory Governance](trajectory-governance.md) identifies future durable trajectory receipts; [MCP Governance](mcp-governance.md) produces governed tool decisions; [Open Problems](open-problems.md) limits what a receipt can establish.

## Open questions

Receipts establish integrity and recorded provenance within their documented signing boundary; they do not independently establish benchmark completeness, scoring validity, or the unresolved analytical proof. See [`docs/production-readiness.md`](../../production-readiness.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [update notes](../../../research/paper-updates.md) · **Benchmarks:** [LexBench receipts](../../../lib/lexbench/receipt.ts) · **Related concepts:** [Atlas index](../index.md)
