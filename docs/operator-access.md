# Lex Aureon operator MCP access

The MCP authorization control plane is available to authenticated, admin-issued `private_test` API keys and to a dedicated operator using the optional server-to-server `MCP_OPERATOR_SECRET`.

## Configure the operator secret

Set a high-entropy value for `MCP_OPERATOR_SECRET` in the deployment environment:

- **Vercel:** Project → Settings → Environment Variables → `MCP_OPERATOR_SECRET`
- **Local development:** add it to `.env.local`

Do not commit the value, put it in an agent prompt, or send it through a model-visible tool argument. The agent host or MCP client should inject it as an HTTP header.

The secret remains separate from `ADMIN_PASSWORD` and API keys. It is an optional alternative for a distinct operator principal; a `private_test` key does not need this header. Private-test calls remain bound to the API-key actor and consume that key's normal quota.

## MCP endpoint

Use:

```text
POST https://lexaureon.com/api/mcp
Header: x-lex-operator-secret: <MCP_OPERATOR_SECRET>
Header: content-type: application/json
```

An operator using this header does not need an API key. The server identifies that caller as `operator` and exposes the operator tools. Private-test callers instead authenticate with `x-lex-api-key` (or Bearer) and are identified as `api_key:<key-id>`.

## Discover the operator tool surface

```bash
curl -sS https://lexaureon.com/api/mcp \
  -H "content-type: application/json" \
  -H "x-lex-operator-secret: $MCP_OPERATOR_SECRET" \
  --data '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
```

The response should include internal tools such as `read_file`, `write_file`, `patch_file`, `dispatch_workflow`, `query_database`, `get_workflow_log`, and `run_self_test`.

## Call a tool

```bash
curl -sS https://lexaureon.com/api/mcp \
  -H "content-type: application/json" \
  -H "x-lex-operator-secret: $MCP_OPERATOR_SECRET" \
  --data '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"get_build_status",
      "arguments":{}
    },
    "id":2
  }'
```

For a trajectory-controlled sequence, first call `declare_trajectory_plan` with the exact ordered actions, then make the corresponding `tools/call` requests using the same `session_id`. This adds durable scope/order checks and prevents concurrent duplicate execution.

## Consequential actions

The operator profile is broad, but it is not a bypass around Lex governance:

- Every tool call still passes through the constitutional tool executor.
- Admin-issued `private_test` API-key calls automatically receive a short-lived, single-use approval bound to the authenticated key actor, resolved MCP session, tool, and exact arguments for registered consequential capabilities. This removes the second authorization round-trip without bypassing the constitutional executor or trajectory gates.
- `authorize_tool_action` remains available for clients that want explicit pre-authorization; its default session ID now matches ordinary MCP calls.
- `authorize_external_action` remains operator-only and does not itself execute an external action.
- Unknown, unregistered, out-of-scope, or constitutionally denied tools remain blocked.
- An uncertain trajectory outcome is locked fail-closed; verify the receipt/state before retrying.

## Agent configuration pattern

Configure the agent's MCP transport to add this header at the HTTP client layer. The exact field name varies by agent host, but the important properties are:

```text
URL:     https://lexaureon.com/api/mcp
Headers: x-lex-operator-secret = secret stored in the agent host's secret manager
```

Prefer a dedicated service account/agent deployment, a separate operator secret per environment, outbound network restrictions, and secret rotation. Do not give the operator secret to untrusted prompts, browser-side JavaScript, or general-purpose model context.

## Private test keys versus operator access

A `private_test` API key receives the complete internal and authorization-control surface, including repository writes, CI dispatch, database reads, receipt operations, `authorize_tool_action`, and `authorize_external_action`. Calls remain authenticated, quota checked, and subject to the constitutional execution gateway; approval tokens are bound to the API-key actor and exact action. Use the optional operator header only when a distinct operator principal is needed.
