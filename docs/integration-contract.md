# Lex Aureon integration contract

This document is the short contract for external integrators. The copy-paste path is available at [`/quickstart`](https://www.lexaureon.com/quickstart); the full endpoint reference remains at [`/api-docs`](https://www.lexaureon.com/api-docs).

## First request

Use `POST /api/lex/govern` with a stable application `session_id`. Anonymous requests are deliberately budgeted. Production integrations should create a Lex API key and send it in `x-lex-api-key` or `Authorization: Bearer`.

```bash
curl -sS https://www.lexaureon.com/api/lex/govern \
  -H 'content-type: application/json' \
  -H 'x-lex-api-key: lex_sk_YOUR_KEY' \
  -d '{"prompt":"Summarize this text safely.","session_id":"my-app","turn":1}'
```

Save `receipt_id` from the response. It is the handle for public evidence lookup; prompts, raw arguments, and credentials are not returned by the audit endpoints.

## MCP transport

The canonical MCP endpoint is `/api/mcp`. Lex currently implements the JSON-RPC handshake-era revisions `2024-11-05`, `2025-03-26`, `2025-06-18`, and `2025-11-25`. An unsupported requested revision receives the newest supported handshake revision as a counter-offer. Lex does not claim the newer stateless/server-discover protocol until its envelope and lifecycle semantics are implemented.

MCP clients may authenticate with an API key, OAuth bearer token, or an operator/session credential where explicitly enabled. Missing or invalid credentials receive both an HTTP challenge and, where appropriate, the MCP-native `_meta["mcp/www_authenticate"]` challenge. Governed denials are valid MCP tool results with `isError: true`; they are not transport failures.

## Identity and sessions

A client session label is not an ownership credential. Non-operator MCP sessions are canonicalized under the authenticated owner before trajectory state or tool execution is evaluated. Operator sessions are intentionally unrestricted for controlled administration. Integrations must not reuse a user-provided session label across owners.

The text-governance API accepts a client `session_id` for continuity. Applications that need per-owner memory isolation should use one key per owner and a stable, owner-specific session namespace.

## Recovery probe boundary

`run_recovery_canary` is registered as `recovery_probe`, not as an ordinary read or write capability. It can inspect the exact canonical state snapshot and persist narrowly scoped recovery evidence, but it does not grant ordinary write authority and cannot authorize a consequential action. Recovery probes remain subject to credential, owner allowlist, trajectory, and canonical-state checks.

## Observability

Read-only observability responses include an `x-request-id` response header and a matching `request_id` field on error payloads. Clients should propagate their own `x-request-id` when troubleshooting. Do not send prompts, raw tool arguments, API keys, OAuth tokens, or operator secrets to logs or support tickets.

## Dependency policy

Dependency upgrades are kept separate from governance and integration changes. Before upgrading dependencies, run `npm audit`, review transitive advisories, then run the complete test, typecheck, lint, and production-build gates. Automatic major-version upgrades are not applied as part of an integration PR.
