# Security model

## Public endpoints

Public governance requests are protected by JSON body-size limits, prompt and session bounds, integer bounds for turn numbers, optional API-key validation, IP-based sliding-window limits, generic client-facing errors, structured server-side logging, and no-store response headers.

Anonymous callers receive a smaller budget than authenticated API-key callers. API keys also have plan-level run allowances tracked in Turso.

## Tool governance boundaries

`/api/mcp` is the only authenticated agent execution boundary. Ordinary API keys grant public MCP capabilities only. Lex infrastructure tools require either an admin-issued `private_test` API key or the separate `MCP_OPERATOR_SECRET`; neither path accepts `ADMIN_PASSWORD` as an MCP credential. Private-test keys remain quota-checked and governed, and their audit identity stays bound to the API-key ID. Clients may exchange a header-delivered API key at `POST /api/mcp/session` for a 15-minute `x-lex-session-token`; query-string credentials are not accepted. Rate-limit and governance-state failures fail closed.

The governed application does not forward arbitrary tool calls to remote MCP servers. This avoids a second egress policy and prevents misleading retry semantics for remote mutations. Clients that need a remote MCP server should connect to that server directly, or register an explicit integration whose capability, approval, and result contract are governed through `/api/mcp`.

Tool receipts store an authenticated actor identifier (`operator`, `api_key:<key-id>`, or `internal-agent`) and a hash of arguments, never the raw credential or raw arguments. This identifies the authenticated principal, not necessarily the human or model behind a shared key.

## Account and tenant-scoped approvals
An approval URL is a navigation hint to the authenticated approval inbox, not a bearer capability. The approver must sign in with a verified account session. The inbox lists only requests for the session's tenant, and every decision is written through a conditional update requiring the request tenant to match that authenticated tenant while the request is pending and unexpired. A zero-row update is an explicit conflict; it must never be displayed as a successful decision. A recorded approval is consent only: execution still requires the unchanged action arguments, one-time consumption, and a fresh governance/recovery check.


Tenants register with an email address, company name, and password. Passwords are stored as salted scrypt digests; raw passwords and verification tokens are never stored. Registration is not activated until the single-use, short-lived email verification link is confirmed. The verification email requires `RESEND_API_KEY`; when email delivery is not configured or fails, registration and approval sign-in fail closed. Browser account sessions are signed with `MCP_SESSION_SECRET` and stored only in an `HttpOnly`, `SameSite=Strict` cookie (also `Secure` in production). Account sign-in and sensitive browser POSTs validate the request origin and apply rate limits.

Each verified account owns a personal tenant. API keys created from the account dashboard are members of that tenant; an account email by itself does not grant key creation, listing, revocation, or approval access. Existing legacy keys are not automatically reassigned based on email. Approval requests are bound to both the API-key owner and its tenant; the inbox and conditional approve/deny write are filtered server-side by the verified tenant-owner session. Requests without a tenant binding (including historical pre-migration rows and operator-principal requests) are not shown to tenant accounts.

Legacy API keys created through the old email-only endpoint remain valid for API calls but are not automatically linked to an account; users must create account-bound keys for tenant-scoped approval workflows. Key creation in the self-serve dashboard is limited to three free keys per tenant; plan upgrades remain an out-of-band provisioning action.

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
