# Lex Aureon operator MCP access

The operator path is a **server-to-server control-plane credential**, not a private test key.

## Configure the operator secret

Set a high-entropy value for `MCP_OPERATOR_SECRET` in the deployment environment:

- **Vercel:** Project → Settings → Environment Variables → `MCP_OPERATOR_SECRET`
- **Local development:** add it to `.env.local`

Do not commit the value, put it in an agent prompt, or send it through a model-visible tool argument. The agent host or MCP client should inject it as an HTTP header.

The secret is deliberately separate from `ADMIN_PASSWORD`, API keys, and private-test keys. If it is unset, the operator profile is unavailable and only public MCP tools can be used.

## MCP endpoint

Use:

```text
POST https://lexaureon.com/api/mcp
Header: x-lex-operator-secret: <MCP_OPERATOR_SECRET>
Header: content-type: application/json
```

An operator does not need an API key for the MCP operator path. The server identifies the actor as `operator` and exposes the public tools plus the internal infrastructure tools.

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
- `authorize_tool_action` can issue a short-lived, exact-arguments approval token for consequential capabilities.
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

A `private_test` API key receives the complete internal tool surface, including repository writes, CI dispatch, database reads, and receipt operations. Those calls still pass through the constitutional execution gateway. Use the operator header when an agent needs authorization control-plane operations (`authorize_tool_action` or `authorize_external_action`) or when you want a distinct operator principal; private-test keys cannot issue authorization tokens.
