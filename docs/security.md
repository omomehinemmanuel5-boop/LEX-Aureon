# Security model

## Public endpoints

Public governance requests are protected by JSON body-size limits, prompt and session bounds, integer bounds for turn numbers, optional API-key validation, IP-based sliding-window limits, generic client-facing errors, structured server-side logging, and no-store response headers.

Anonymous callers receive a smaller budget than authenticated API-key callers. API keys also have plan-level run allowances tracked in Turso.

## Tool governance boundaries

`/api/mcp` and `/api/tool-proxy` are distinct authenticated boundaries. On `/api/mcp`, API keys grant public MCP capabilities only; Lex infrastructure tools require the independent `MCP_OPERATOR_SECRET`, never `ADMIN_PASSWORD`. Clients may exchange a header-delivered API key at `POST /api/mcp/session` for a 15-minute `x-lex-session-token`; query-string credentials are not accepted. The separate tool proxy bounds JSON bodies, applies IP rate limits before governance work, consumes valid API-key quota atomically, and namespaces sessions by API-key identity. Rate-limit and governance-state failures fail closed.

Outbound forwarding from `/api/tool-proxy` is disabled unless `TOOL_PROXY_ALLOWED_HOSTS` contains exact hostnames. Targets must use HTTPS, omit URL credentials, use the default HTTPS port, resolve only to public addresses, and are not allowed to redirect. The connection pins the validated DNS address while preserving TLS hostname verification. A timeout, transport error, redirect, non-2xx response, or JSON-RPC error after dispatch is an **unknown remote outcome**, not a denial or a safe-to-retry signal; clients must verify target state before retrying.

Tool receipts store an authenticated actor identifier (`operator`, `api_key:<key-id>`, or `internal-agent`) and a hash of arguments, never the raw credential or raw arguments. This identifies the authenticated principal, not necessarily the human or model behind a shared key.

Admin-issued `private_test` MCP keys are trusted internal-development credentials: they expire after two hours, are subject to issuance rate limits, and receive the complete internal tool surface, including `authorize_tool_action` and `authorize_external_action`. Consequential approvals are bound to the authenticated API-key actor and exact action; private-test authorization calls consume that key's normal quota and still pass through the constitutional execution gateway. Public API keys remain excluded from internal and authorization-control tools. `MCP_OPERATOR_SECRET` remains an optional, separate operator principal for dedicated service clients.

## Sensitive areas

Admin, benchmark publishing, cron, key management, and debug routes remain sensitive and require their own authorization review. These controls do not make actions outside the governed tool entry points visible to the tool governor.

## Reporting a vulnerability

Do not include secrets, tokens, private keys, database exports, or exploit payloads in a public issue. Contact the maintainer privately with the affected route, impact, reproduction steps, and a minimal sanitized example.

## Receipt integrity

Governance receipts bind the input, output, and constitutional state through hashes. Evaluation artifacts under `lib/artifact_signer.ts` additionally use Ed25519 signatures so a verifier can check both content integrity and possession of the signing key. Receipt verification must fail closed when a signature, public key, or bound hash is invalid. Hashes alone are not an authenticity mechanism.

Signing keys must remain outside the repository, use restrictive file permissions, and be rotated according to the deployment's operational policy. A valid signature proves that the artifact was signed by the corresponding key; it does not by itself prove that the run was complete, independently reproduced, or scientifically valid.

## Dependency failure policy

The application must document whether each dependency failure is fail-open, fail-closed, or degraded. In particular, database, embedding-provider, model-provider, and receipt-persistence failures must not silently be presented as a healthy, fully auditable governance decision. High-risk external or destructive actions should require an explicit policy decision when current constitutional state or receipt persistence is unavailable.

## Security review checklist

- Confirm auth is enforced before expensive provider or database work.
- Confirm rate-limit failures and database failures are observable.
- Confirm logs never include bearer tokens or raw API keys.
- Confirm errors do not reveal provider URLs, SQL, stack traces, or credentials.
- Confirm governance-math changes include regression tests and research-status updates.
