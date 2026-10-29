# Design Proposal: Recovery and Scoped Grants

**Status: proposal only.** This document records alternatives for owner review. It does not implement or authorize any alternative. Source paths below describe the current repository unless explicitly labelled as proposed behavior.

## 1. Problem and current evidence

- **Recovery is session-scoped and snapshot-sensitive.** `lib/agents/recovery_runtime.ts` exposes `advanceRecoveryPlane(sessionId)`, which reads and updates the trajectory for that session. `lib/agents/recovery_canary_evidence.ts` fingerprints the session, policy version, C/R/S, `nStable`, and `sigmaViol`; its validity check also checks current velocity, the stable count, expiry, and write count. A changed canonical snapshot can make earlier canary evidence stale.
- **The executor can advance recovery around consequential actions.** `lib/agents/constitutional_tool_executor.ts` uses `shouldAdvanceRecoveryBeforeTool` to decide whether to call `advanceRecoveryPlane` before an eligible action, and `shouldRecordTrajectoryObservation` to decide whether to record a post-call observation. These predicates are state/tool-dependent; they do not prove that every write unconditionally resets `n_stable`.
- **Approvals are exact-action and single-use.** `lib/approval_requests.ts` stores `owner_id`, `session_id`, `tool_name`, `args_hash`, status and expiry; `approvalArgsHash` hashes canonical arguments, and `consumeApprovalRequest` checks the binding and consumes the approved request once. `REQUEST_TTL_MS = 15 * 60 * 1000` sets the 15-minute request lifetime.
- **The default session is stable per actor for stateless MCP clients.** `defaultMcpSessionId` in `lib/mcp_http.ts` derives `mcp-<12-hex-actor-hash>` without a UTC date; `canonicalMcpSessionId` prefixes non-operator sessions with the authenticated owner ID. Explicit client `session_id` values still take precedence, and operator session handling remains separate. Stable identity does not prove the selected production trajectory belongs to the intended actor/owner; verify the existing row before assuming continuity is safe.
- **The registered GitHub write tools are branch-constrained but currently do not accept the docs prefix.** `lib/lex_crs_agent/tools/github_branch_validation.ts` accepts `govern/` and `fix/` in `validateTargetBranch`. The current tool registry is `lib/lex_crs_agent/tools.ts`; a file named `tool_crs.ts` was not found by the repository search, so this proposal cites the actual registry path instead.

## 2. Option A — Separate code lane

**Concept.** Repository code changes use each agent's own GitHub identity/access: create a topic branch, commit only to that branch, open a PR, and wait for owner review and merge. Lex governance review and the live runtime gate remain separate from GitHub commit authorization.

**Safety argument.** A commit is proposed, not deployed to `main`; the bad-commit path is constrained by branch protection, review, required checks, and the owner's merge decision. This shifts routine repository authoring out of the live runtime trajectory without granting agents authority to merge or write to `main`.

- **Governance change:** process/policy clarification only; no Lex runtime bypass. Agents must not use default-branch writes or merge permissions.
- **Affected files:** initially documentation and agent-host/GitHub configuration. If Lex-native branch creation is expected, `lib/lex_crs_agent/tools/github_branch_validation.ts` would need a separately reviewed change to support `docs/`; this is not included here.
- **Tests needed:** verify the agent can create a branch, commit to that branch, open a PR, and cannot write to `main` or merge; validate required branch protection/checks and actor attribution.
- **Risk:** a malicious or incorrect patch can still be proposed; a weak review or branch-protection configuration could allow it to reach `main`.
- **Owner decision:** decide whether repo writes should be governed by Lex per action, by GitHub identity plus branch protection/PR review, or by a hybrid policy.
- **Status:** documentation/process-only proposal; no runtime code change is implied.

## 3. Option B — Repository writes do not move the runtime trajectory

**Concept.** Classify repository-only GitHub writes separately from actions that operate on Lex's live governed runtime. A successful branch commit or PR operation would not, solely because it is a repository write, advance or reset the live runtime trajectory. Runtime-affecting tools would continue through existing governance and recovery checks.

**Relevant current code path.** `lib/agents/tool_crs.ts` measures tool-call CRS; `lib/lex_crs_agent/tools.ts` registers `write_file`, `create_branch`, and `open_pr`; `lib/agents/constitutional_tool_executor.ts` contains `shouldAdvanceRecoveryBeforeTool`, `shouldRecordTrajectoryObservation`, and the calls into recovery/trajectory persistence; `lib/agents/recovery_runtime.ts` mutates the trajectory for a given session.

**Safety argument and proof obligations.** A GitHub commit is an external repository side effect and does not itself execute application code in the live runtime. However, it can change code that may later be deployed, and GitHub operations can have their own security impact. Before adopting this separation, prove that repository-only tools cannot mutate the canonical governance database, runtime policy, production environment, or a deployment target; that they remain bound to an authenticated actor and exact arguments; and that all runtime-affecting actions still advance/check the trajectory as intended. Preserve fail-closed behavior when canonical state is unavailable.

- **Governance change:** change the tool-to-trajectory classification only after a reviewed invariant establishes which tool classes are repository-only. Do not simply exempt every tool whose name contains `write`.
- **Affected files:** likely `lib/agents/constitutional_tool_executor.ts`, the tool capability/registry metadata in `lib/agents/tool_capability_registry.ts` and `lib/lex_crs_agent/tools.ts`, plus tests. `lib/agents/recovery_runtime.ts` should change only if the proven semantics require it.
- **Tests needed:** repository writes do not mutate `z_traj` or invalidate unrelated runtime evidence; runtime-affecting writes still advance recovery; tool-name spoofing cannot gain the exemption; canonical-state/storage failures remain fail-closed; exact-action approval is still enforced.
- **Risk:** incorrect classification could let a runtime mutation evade recovery observation or invalidate an important safety invariant.
- **Owner decision:** decide whether the repository/runtime separation is a valid invariant and approve the precise allowlist of repository-only tools.
- **Status:** requires governance and security review before code.

## 4. Option C — Stable session identity per agent

**Concept.** Configure each agent connector to send a persistent, unique `session_id` on MCP calls, rather than relying on the default date-derived session. The route's `defaultMcpSessionId` in `app/api/mcp/route.ts` should remain unchanged. `canonicalMcpSessionId` owner-prefixes non-operator sessions; the supplied session remains subject to that owner binding.

**What it changes.** Recovery observations and canary evidence can remain associated with the same agent session across UTC date boundaries, reducing daily re-bootstrap friction for stateless clients. It does not bypass per-action approval, change a canary's exact-snapshot binding, or make evidence transferable between agents.

**Risk.** Trajectory and history accumulate across days, so old state, accumulated observations, and a long-lived session need explicit monitoring and lifecycle/rotation rules. Reusing one session across agents would conflate their histories and is not allowed.

- **Governance change:** connector configuration and operator process, not a change to the default session function.
- **Affected files:** agent-host/MCP connector configuration and documentation; no source code is required if the client already supports `session_id`.
- **Tests needed:** repeated calls across a UTC date boundary use the same explicit session; two agents use distinct IDs; owner prefixing remains enforced; canary evidence remains session-bound and stale evidence is rejected.
- **Owner decision:** set a stable session ID per agent, define a naming convention, and decide when an agent's session is rotated.
- **Status:** connector setting; no code implementation proposed here.

## 5. Option D — Scoped grants for live actions

**Concept.** Replace repeated human approval for a narrowly defined sequence with an explicit, time-limited grant created by a human operator. This is a proposal only; the current `lib/approval_requests.ts` mechanism is exact-action, short-lived, and single-use.

A grant would require all of the following:

1. **Explicit allowlist:** exact registered tool names, with no wildcard tools.
2. **Argument constraints:** canonical argument patterns validated by the server (for example, branch names must match an approved prefix and must not target `main`). Pattern matching must be structured and fail closed, not an unsafe string-substring check.
3. **Use limit:** a finite maximum number of successful consumptions; every attempt is checked atomically against the remaining count.
4. **Expiry:** no more than one hour from issuance; expired grants are unusable even if the caller retries.
5. **Agent binding:** authenticated owner/actor identity plus a dedicated agent identity and session binding. A caller-supplied label alone is not proof of identity. The binding model should be reviewed against the existing owner/session/tool/argument hash fields in `lib/approval_requests.ts`.
6. **Revocation:** the owner/operator can revoke a grant immediately; each consumption checks revocation state from the authoritative store. Revocation/storage errors fail closed.
7. **Audit trail:** record grant ID, issuer, bound agent, allowed tool, canonical argument hash/pattern match, time, use number, outcome, and revocation/expiry. Never log secrets or bearer tokens.
8. **Hard exclusions:** a grant cannot authorize writes to `main`, merges, or any tool not explicitly named in the allowlist. Those operations remain unavailable even if a caller asks to add them to a grant.

**Governance change.** Introduce a distinct grant type and enforcement path rather than weakening or reinterpreting the existing single-use approval record. The executor must validate the grant immediately before dispatch and bind the resulting receipt to the grant and exact action. No grant may bypass recovery/canary checks, capability classification, OAuth authentication, or branch protection.

- **Affected files:** likely `lib/approval_requests.ts` or a new scoped-grant module, `lib/agents/constitutional_tool_executor.ts`, tool capability/branch validation, approval UI/control-plane routes, audit receipt schema, and tests. These are candidate areas, not an implementation commitment.
- **Tests needed:** wrong actor/session/tool, disallowed argument pattern, `main`/merge exclusion, unlisted tool, expiry, revocation, exhausted use count, concurrent double-consumption, replay, storage failure, audit completeness, and recovery/canary still being enforced.
- **Risk:** a pattern that is too broad or a race in use-count enforcement can turn convenience into ambient authority.
- **Owner decision:** decide whether scoped grants are acceptable at all, which tool/argument patterns are eligible, grant limits, and who can issue/revoke them.
- **Status:** requires governance and security review before code.

## 6. Adoption sequence to review (not a final option selection)

This sequence is about reducing dependency and making decisions in a safe order; it does **not** select any option as the final design.

1. **Clarify the process boundary (Option A):** agree on branch/PR ownership and branch protections before delegating more agents; it requires no runtime-policy change.
2. **Decide session operations (Option C):** connector settings can be evaluated independently, while explicitly documenting cross-day accumulation and per-agent uniqueness.
3. **Prove repository/runtime separation (Option B):** establish the invariants and tests before changing the trajectory classification; do not infer safety solely from tool names.
4. **Evaluate scoped grants (Option D):** only after actor binding, atomic use limits, revocation, audit semantics, and hard exclusions are specified and independently reviewed.

The owner may reject, reorder, or combine these options after review. None is implemented by this document.

## 7. Non-goals

- No changes to approval security or the existing exact-action binding.
- No changes to canary logic, recovery logic, stability thresholds, CRS bounds, or sigma limits.
- No changes to `lib/mcp_oauth.ts`.
- No production environment-variable changes.
- No writes to `main`, no merges, and no grant that authorizes main writes or merges.
