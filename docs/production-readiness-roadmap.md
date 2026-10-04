# Lex 10/10 Production-Readiness Roadmap

## Executive recommendation

Lex should become **progressively frictionless, not permissionless**.

The target experience is:

> Read and reason freely. Discover capabilities automatically. Explain the planned consequence before acting. Ask for approval only at the smallest consequential boundary. Execute exactly what was approved. Verify and report the result.

Lex already has the foundations for this model: effect-based capabilities, trajectory governance, fail-closed behavior, action-bound approval tokens, simulation, receipts, and external capability discovery. The next step is to make those foundations feel like one coherent product rather than several powerful subsystems that can drift out of sync.

---

## Recommended scorecard

| Area | Current direction | 10/10 target |
|---|---|---|
| Security | Strong fail-closed controls | Proven policy invariants and continuous adversarial testing |
| Agent UX | Smooth for reads, friction at writes | One clear approval boundary with no unnecessary repeats |
| MCP compatibility | Mostly working, but envelope defects were found | Protocol-conformance suite against ChatGPT, Claude, and generic MCP clients |
| Capability model | Explicit registry plus discovery | One canonical capability source with automatic consistency checks |
| Approvals | Exact action-bound tokens | Human-readable previews, batched approvals, replay protection, expiry visibility |
| Trajectories | Strong conceptual model | Durable checkpoints, resumability, drift explanations, idempotent retries |
| Observability | Receipts and state available | Full decision traces, latency metrics, failure taxonomy, operator dashboard |
| Deployment | CI and Vercel checks exist | Canary releases, rollback automation, migration gates, SLOs |
| Developer experience | Powerful but distributed | Typed SDK, local simulator, contract fixtures, one integration guide |
| Product trust | Good safety story | Clear guarantees, limitations, and customer-facing audit exports |

---

# Priority 0: Make the protocol and authorization path boring

## 1. Build a real MCP conformance test suite

The most visible failure found during testing was not a policy failure. It was a malformed MCP response: discovery succeeded internally, but the client reported **“content is missing”** because the route returned a broker object without the required `result.content` envelope.

This class of defect must be caught before deployment.

Create contract tests for every MCP method:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`
- `ping`
- OAuth challenge responses
- OAuth protected-resource metadata
- OAuth authorization-server metadata
- Dynamic client registration
- Authorization-code exchange
- Refresh-token exchange
- Error responses

For every tool call, assert:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "..." }
    ]
  }
}
```

Also test optional `structuredContent`, because capable clients can consume structured results without parsing text.

Run these tests against:

1. The route directly
2. The deployed preview
3. Production after deployment
4. A generic MCP client fixture
5. ChatGPT-style and Claude-style request fixtures

## 2. Create one canonical response builder

Do not let each route branch construct MCP responses independently. Use helpers such as:

```ts
mcpToolSuccess(id, value)
mcpToolError(id, code, message)
mcpAuthChallenge(id, metadataUrl)
```

The helper should enforce:

- Correct JSON-RPC shape
- `result.content`
- Stable error codes
- `id` preservation
- `Cache-Control` behavior
- Optional `structuredContent`
- Redaction of secrets

This prevents another special branch from bypassing protocol requirements.

## 3. Add client-compatibility smoke tests

Maintain a small matrix:

| Client | Auth mode | Expected result |
|---|---|---|
| Generic MCP client | OAuth | Connect and list tools |
| Generic MCP client | Bearer/API key | Connect and call read tool |
| ChatGPT-style client | OAuth | Complete callback and token exchange |
| Claude-style client | OAuth | Complete callback and token exchange |
| Claude-style client | Custom header | Call read tool |
| Mobile browser | OAuth | Complete authorization screen |

Record every request and response shape in a privacy-safe test fixture.

---

# Priority 1: Eliminate registry drift

The first live simulation found that external governance tools were exposed by the MCP route but missing from the static capability registry. Lex correctly failed closed, but the user experience was confusing because the same tool was:

- Advertised by MCP
- Routed by the endpoint
- Unknown to the simulator/reference monitor

This is the biggest architectural lesson so far: **tool exposure, implementation, capability registration, and simulation must come from one source of truth.**

## 4. Generate all tool surfaces from one manifest

Define a canonical tool manifest containing:

```ts
interface GovernedToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  capability: ToolCapability;
  approvalRequired: boolean;
  reversible: boolean;
  accessProfiles: McpAccessProfile[];
  handler: ToolHandler;
}
```

Generate from it:

- MCP `tools/list`
- Static capability registry
- Access-profile filters
- Simulation classifications
- SDK types
- Documentation
- Contract tests

Then add a build-time invariant:

```text
Every exposed tool must have exactly one capability record and exactly one handler.
Every registered handler must be either exposed or explicitly internal.
```

## 5. Separate control-plane tools from action-plane tools

Make this distinction explicit in code and documentation:

### Control-plane tools

- Discover a capability
- Review an action
- Govern an action
- Issue a permit
- Consume a permit
- Explain a denial
- Simulate a trajectory

### Action-plane tools

- Send an email
- Write a file
- Deploy code
- Delete records
- Make a purchase
- Publish a message

Control-plane tools may be callable with low friction, but they must never silently perform action-plane work.

This makes it easier to let agents reason about actions without accidentally granting execution authority.

## 6. Add registry drift CI

Fail CI if any of these sets differ unexpectedly:

```text
MCP advertised tools
TOOL_REGISTRY handlers
capability registry
access-profile definitions
OpenAPI/SDK definitions
```

The previous incident should become a permanent regression test, not institutional memory.

---

# Priority 2: Make approvals feel frictionless

Security is not frictionless if users must repeatedly approve the same obvious action. The solution is not to remove approval. The solution is to improve the approval unit.

## 7. Use risk-adaptive approval granularity

Use four approval modes:

### Mode A: Automatic

For low-risk, read-only actions:

- Read files
- Search code
- Check status
- Discover a manifest
- Simulate a plan
- Review a proposed action

No user interruption.

### Mode B: Soft confirmation

For reversible, bounded writes:

- Edit a draft
- Create a branch
- Update a non-production record
- Generate a local artifact

Show a compact preview and allow one-tap approval.

### Mode C: Strong approval

For external, public, identity, financial, or production actions:

- Exact target
- Exact payload
- Expected side effect
- Reversibility
- Expiry
- Actor identity

Require explicit approval.

### Mode D: Human takeover or dual control

For the highest-impact actions:

- Destructive production deletion
- Billing or purchases
- Access ownership changes
- Credential rotation
- Public legal/financial/government submissions

Require a human-controlled step, and optionally a second approver.

## 8. Show an approval preview in plain language

Do not present users with only:

```text
approval_required
```

Return a preview such as:

> Lex wants to send this exact email to 3 recipients from `support@...`. This is an external action. It can be cancelled before sending. Approval expires in 15 minutes.

Every approval screen should show:

- What will happen
- Where it will happen
- Who will be affected
- What data will leave Lex
- Whether it is reversible
- What approval is being granted
- How long it lasts

## 9. Batch only equivalent approvals

Allow an agent to request one approval for a bounded set of equivalent actions only when:

- Same tool
- Same environment
- Same actor
- Same risk class
- Same target scope
- Same maximum quantity
- Same expiration

Never convert a specific approval into a general tool permission.

## 10. Make approval failures self-explanatory

Return machine-readable and human-readable fields:

```json
{
  "decision": "approval_required",
  "reason_code": "EXTERNAL_ACTION_REQUIRES_APPROVAL",
  "message": "This action would publish externally.",
  "next_step": "Request approval for the exact payload.",
  "preview": { "...": "..." }
}
```

An agent should know whether to:

- Retry unchanged
- Ask the user
- Rediscover the tool
- Refresh a token
- Change the plan
- Stop permanently

---

# Priority 3: Make OAuth and API-key authentication reliable

The authentication investigation showed that Lex could create authorization codes, but ChatGPT and Claude did not complete token redemption in the earlier flow. That means the service needs observability at every OAuth stage, not just a final “connected/not connected” state.

## 11. Add an OAuth transaction state machine

Track a privacy-safe transaction with states:

```text
registered
→ authorize_started
→ key_validated
→ code_issued
→ callback_received
→ token_exchange_started
→ token_issued
→ first_mcp_call
→ refresh_started
→ refreshed
→ revoked
→ expired
→ failed
```

Never store raw keys, codes, or tokens. Store hashes, timestamps, client IDs, redirect URI hashes, and safe failure codes.

## 12. Add a diagnostic endpoint for the user

Provide a page such as:

```text
/api/auth/diagnostics/:transaction_id
```

It should say:

- “Your key was accepted.”
- “Authorization code was issued.”
- “The client did not redeem the code.”
- “The callback was received but redirect URI did not match.”
- “The token was issued, but the first MCP call lacked a bearer token.”

This would have made the previous investigation much faster and less exhausting for the user.

## 13. Support a documented direct-header mode

Where client policy allows it, support:

```http
Authorization: Bearer <Lex key>
```

or a dedicated header such as:

```http
x-lex-api-key: <Lex key>
```

Document exactly which clients support each mode.

Do not restore query-string credentials on the primary endpoint. If legacy compatibility is unavoidable, put it behind:

- A separate legacy hostname or route
- Short-lived keys
- Strong warnings
- Rate limits
- Log redaction
- An explicit deprecation date

## 14. Add auth observability without secrets

Log only hashed or classified fields:

- Transaction ID
- Client ID hash
- Redirect URI hash
- Request stage
- Error code
- Timestamp
- Latency
- Result

Never log:

- API keys
- Authorization codes
- Access tokens
- Refresh tokens
- Full redirect URLs if they contain sensitive query data

---

# Priority 4: Make trajectories durable and recoverable

## 15. Treat trajectories like durable workflows

A production trajectory should support:

- Checkpoint persistence
- Idempotency keys
- Exactly-once claim semantics
- Safe retry after timeout
- Resume after process restart
- Explicit pause and resume
- Human takeover
- Rollback or compensating actions
- Final reconciliation

The agent should never be forced to guess whether a timed-out external action happened.

Use statuses such as:

```text
planned
claimed
running
succeeded
failed
unknown_after_deadline
paused_for_review
cancelled
reconciled
```

## 16. Improve drift explanations

Instead of only saying “trajectory denied,” explain:

```text
Expected step 3: get_build_status
Received: dispatch_workflow
Reason: external side effect not declared in the active plan
Safe next step: update the trajectory and request deployment approval
```

This is essential for agent usability.

## 17. Add compensating-action patterns

For actions that cannot be rolled back, require the plan to declare:

- Compensation action
- Verification action
- Escalation path
- Maximum exposure

For example:

```text
Create deployment
→ health check
→ if unhealthy, route traffic back
→ lock trajectory if rollback fails
```

---

# Priority 5: Production operations and reliability

## 18. Define SLOs

Set measurable objectives:

| SLO | Initial target |
|---|---:|
| Read-only governance availability | 99.95% |
| Authorization decision p95 latency | < 300 ms excluding external model calls |
| MCP tools/list success | 99.99% |
| OAuth completion success | > 99% for supported clients |
| Receipt persistence success | 99.99% |
| Unknown-action fail-closed correctness | 100% in tested paths |
| Duplicate external execution rate | 0 tolerated incidents |

## 19. Add canary deployment and automatic rollback

Before production:

1. Run unit tests
2. Run protocol contract tests
3. Run security tests
4. Deploy preview
5. Run client compatibility tests
6. Run database migration checks
7. Canary a small percentage of traffic
8. Monitor auth and MCP error rates
9. Promote or rollback automatically

Do not use a generic “latest deployment succeeded” check as proof that the MCP protocol works.

## 20. Make migrations explicit and reversible

Every schema change should have:

- Version number
- Forward migration
- Compatibility window
- Rollback or repair procedure
- Startup health check
- Migration telemetry

Avoid silently swallowing all migration errors. Distinguish:

- Already exists
- Compatible old deployment
- Temporary database outage
- Schema corruption

A fail-closed governance system must also be able to explain whether it failed because policy denied an action or because persistence was unavailable.

## 21. Add rate limits by capability, not just endpoint

Examples:

- Reads: high quota
- Discovery: moderate quota
- Governance reviews: moderate quota
- Token issuance: low quota
- External execution permits: very low quota
- Failed auth: aggressive throttling
- Destructive attempts: immediate alerting

Rate-limit by actor, key, environment, and IP-derived risk signal where appropriate.

---

# Priority 6: Security hardening

## 22. Add invariant tests

Write tests for statements that must always be true:

```text
Unknown capability never executes.
Discovery never grants execution permission.
Approval tokens cannot be reused.
Approval tokens cannot be used with modified arguments.
Expired tokens never execute.
A token for actor A cannot be used by actor B.
A token for environment A cannot be used in environment B.
A read-only tool cannot issue a consequential permit accidentally.
External adapters cannot execute through Lex without the final consume gate.
Secrets never appear in logs, receipts, errors, or URLs.
```

## 23. Run adversarial testing continuously

Add automated scenarios for:

- Tool-name spoofing
- Manifest poisoning
- Prompt injection in descriptions
- Schema manipulation
- Approval-token replay
- Redirect URI confusion
- OAuth mix-up attacks
- Session fixation
- Cross-tenant access
- Environment substitution
- Unicode confusables in tool names
- Case normalization bugs
- Concurrent permit consumption
- Timeout/retry duplication
- Destructive action hidden behind a read-like name

## 24. Use formal or property-based tests for the permit system

The approval-token system is a good candidate for property testing:

```text
For every generated action A and modified action A',
consume(token(A), A') must fail.
```

Also test random concurrency around:

- Two consumers using the same token
- Refresh plus revoke
- Expiry during consumption
- Duplicate request IDs
- Conflicting trajectory versions

---

# Priority 7: Developer and integrator experience

## 25. Publish a single integration guide

The guide should contain:

- Recommended MCP URL
- OAuth metadata URLs
- Supported auth modes
- ChatGPT setup
- Claude setup
- Generic MCP setup
- Mobile limitations
- Troubleshooting flow
- Example `curl` calls
- Expected responses
- Error-code reference
- Security guidance

Most users should be able to diagnose a connection without opening a laptop or contacting the developer.

## 26. Provide a local Lex simulator

Ship a command such as:

```bash
lex simulate-plan plan.json
lex discover manifest.json
lex govern action.json
lex verify-token token.json
```

The simulator should use the same capability registry and transition logic as production, while clearly marking all state as hypothetical.

## 27. Provide typed SDKs

The SDK should expose:

```ts
client.discoverTool(manifest)
client.reviewAction(action)
client.requestApproval(action)
client.consumePermit(permit)
client.simulatePlan(plan)
client.explainDenial(denial)
```

Return typed discriminated unions rather than forcing every caller to parse strings.

---

# Suggested 90-day implementation sequence

## Days 1–14: Reliability foundation

- Canonical MCP response builders
- MCP conformance tests
- OAuth transaction state machine
- Registry drift CI
- Auth diagnostic page
- Secret-redaction audit

## Days 15–30: Frictionless approvals

- Risk-adaptive approval modes
- Human-readable action previews
- Better denial reason codes
- Exact approval-token UX
- Batch approval for bounded equivalent actions

## Days 31–60: Durable autonomy

- Trajectory checkpoints
- Idempotency and reconciliation
- Timeout/unknown-action handling
- Resume and human takeover
- Canary deployment and rollback
- SLO dashboards

## Days 61–90: Ecosystem and assurance

- Typed SDK
- Local simulator
- Client compatibility matrix
- Property-based permit tests
- Red-team suites
- Customer audit exports
- Security review and threat-model update

---

# Definition of “10/10 Lex”

Lex is 10/10 when an agent can do the following without confusion:

1. Discover a new capability automatically.
2. Understand what the capability is allowed to do.
3. Simulate the full plan before execution.
4. Perform all safe read-only preparation without interruption.
5. Receive one concise approval request at the true consequence boundary.
6. Show the human exactly what will happen.
7. Execute only the approved action.
8. Recover safely from timeouts and retries.
9. Explain every denial in plain language.
10. Produce a complete, exportable audit trail.
11. Never leak credentials or silently broaden authority.
12. Work consistently across ChatGPT, Claude, generic MCP clients, and mobile where supported.

The design principle is simple:

> **Make safe behavior automatic, consequential behavior explicit, and failure behavior understandable.**

That is how Lex can become both highly secure and genuinely pleasant for an AI and its user to operate.
