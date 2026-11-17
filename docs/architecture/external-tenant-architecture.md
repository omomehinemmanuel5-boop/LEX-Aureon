# External Tenant Architecture — R1 Design

## Status

This document records the staged design for turning Lex Aureon’s existing external governance interfaces into a tenant-isolated integration platform. It does not claim that multi-tenancy is implemented by this change.

## Existing integration surfaces

The repository already has:

- `/api/lex/govern` for text governance.
- `/api/mcp` for authenticated MCP tools.
- `/api/lex/capabilities/discover` for REST capability discovery.
- `lib/agents/tool_capability_discovery.ts` for persistent, environment-namespaced tool manifests.
- `lib/agents/external_capability_broker.ts` for discover → govern → authorize/consume permit.
- `lib/agents/constitutional_tool_executor.ts` for the internal governed execution boundary.
- `sdk/src/index.ts` as the root TypeScript workspace SDK.

The external broker governs client-side actions; it does not itself execute arbitrary client tools. A client adapter must consume the exact permit immediately before execution. This is an integration trust boundary, not a guarantee that Lex can prevent a customer from bypassing Lex if that customer leaves an unrestricted alternative execution path available.

## Tenant identity model

The target identity dimensions are deliberately distinct:

- `tenantId`: owner of the governance space.
- `actorId`: authenticated human, service principal, or API credential acting now.
- `agentId`: registered agent identity, when supplied by a trusted integration.
- `environmentId`: registered application/runtime namespace owned by a tenant.
- `sessionId`: tenant-scoped continuing governance session.
- `runId`: unique execution attempt.

Model-supplied identity fields are never authoritative.

## Migration strategy

Do not infer organizational membership from an API-key email address. The existing API-key endpoint accepts email as a key-management identifier; it is not, by itself, proof of control of an organization or verified membership.

The safe migration sequence is:

1. Introduce tenant, membership, environment, and API-key binding schemas additively.
2. Backfill each existing API key into a distinct personal tenant, preserving its current owner/session namespace. This avoids silently joining unrelated credentials merely because their stored email strings match.
3. Add an explicit, authenticated tenant-claim/invitation flow before allowing multiple keys or members to share an organization tenant.
4. Bind every registered environment to a tenant. Derive the tenant from authenticated credentials; treat caller-provided environment IDs only as selectors that must be checked for ownership.
5. Scope capability discovery, permits, approval requests, receipts, quotas, and policy configuration by tenant while retaining actor-level attribution.
6. Add tenant isolation tests before enabling organization sharing.

Do not migrate existing records by email equality alone. Do not change existing session identifiers until a compatibility migration and ownership mapping are proven.

## R1b tenant schema and provisioning

R1b introduces the additive `tenants`, `tenant_members`, and `tenant_environments` tables and a nullable `api_keys.tenant_id` binding. Each newly generated API key receives a distinct personal tenant, an owner membership (`api_key:<id>`), and a default environment whose ID preserves the existing API-key environment namespace. These four records are created in one database write batch so a partially provisioned key is not returned.

Existing credentials are backfilled by the manual migration `scripts/migrations/2026-11-17-r1b-personal-tenant-backfill.ts`. It derives `tn_personal_<api-key-id>` independently for every credential, never groups by email, never changes session IDs, only fills null tenant bindings, and verifies tenant, owner-membership, and environment mappings after the write. The backfill script is not run by application startup or CI; it is available only through the explicitly dispatched migration workflow. The additive tables and nullable API-key column are initialized by `initApiKeySchema()` when API-key storage is initialized. Review and run it against the intended Turso database after the PR is reviewed and merged.

This schema is a foundation, not complete multi-tenancy. Existing governance queries are not yet tenant-scoped by these tables, organization membership/invitations are not enabled, and tenant IDs must not be treated as authorization proof until R1c/R2 enforce ownership at every relevant boundary.

## Capability and enforcement contract

REST and MCP must be adapters over the same underlying governance services, not separate policy engines.

The external action lifecycle should remain:

1. Authenticate tenant and actor.
2. Resolve an environment owned by that tenant.
3. Resolve the registered manifest and its current revision/hash.
4. Evaluate the exact action through Lex governance.
5. Obtain any required human approval.
6. Issue a short-lived, action-bound, single-use permit.
7. Have a trusted client adapter consume the permit immediately before executing the unchanged action.
8. Record the governance decision separately from the adapter-reported execution outcome.

A manifest is untrusted metadata. Tool names, descriptions, JSON schemas, and MCP annotations are classification evidence, not proof of actual runtime behavior. Unknown or ambiguous tools must remain conservatively classified.

The execution-result report must be clearly distinguished from a Lex governance receipt: Lex can attest to its decision; an adapter report records what the adapter claims it executed. Stronger assurance requires adapter authentication/signatures and control over the only route to the consequential resource.

## SDK direction

The repository currently has two TypeScript client implementations:

- Root workspace package: `sdk/src/index.ts`, package name `@aureonics/lex-sdk`.
- Separate source tree: `sdk/typescript/index.ts`, with a different constructor and API contract.

Do not merge these by guesswork. First designate the supported package and preserve compatibility deliberately. A Python SDK should follow the same versioned REST contract after that contract is stable.

## Release boundaries

- R1a: environment ownership enforcement and tenant architecture/migration design.
- R1b: additive tenant schema and safe personal-tenant backfill.
- R1c: authenticated organization membership, invitations, and tenant sharing.
- R2: tenant-scoped external governance lifecycle and execution-result reporting.
- R3: consolidated SDKs, examples, and developer documentation.
- R4: customer administration UI, usage and billing.
- Separate workstream: isolated workspace runner.

R1a's environment-ownership guard and regression tests are merged. The R1b implementation is proposed separately and adds the tenant schema, atomic provisioning for newly created API keys, and a manual backfill script. Neither R1a nor R1b enables organization sharing or claims complete tenant isolation.
