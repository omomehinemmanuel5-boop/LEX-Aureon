# Lex Capability Discovery

Lex does not require a hand-maintained list of every client tool.

## Integration contract

At environment startup:

1. The client/host discovers its native tools.
   - MCP: call `tools/list`.
   - Other runtimes: use the runtime's tool manifest API.
2. Send the returned tool definitions to:
   `POST /api/lex/capabilities/discover`
3. Authenticate with the Lex API key using `x-lex-api-key` (or Authorization Bearer).
4. Lex persists the capability map under the authenticated environment identity.
5. Every later governed action is resolved against:
   - the static Lex core registry, or
   - the discovered environment registry.
6. Unresolved capabilities remain fail-closed.

## Capability ontology

Lex normalizes arbitrary tool names into:

- `read`
- `write`
- `external`
- `destructive`
- `identity`
- `financial`
- `network`
- `execute`
- `delegate`

The name of a tool is not authority. Capability is the security boundary.

## Resolution order

The resolver uses conservative evidence:

1. Explicit dangerous behavior in the tool name/description.
2. MCP annotations such as `destructiveHint`.
3. MCP `readOnlyHint`.
4. External/open-world indicators.
5. Write/read schema and language signals.
6. Otherwise: unresolved.

MCP annotations are hints, not proof. A tool called `delete_customer` is never downgraded to read merely because a server incorrectly advertises `readOnlyHint=true`.

## `exec`

Common execution transports such as `exec`, `shell`, `bash`, `powershell`, `python`, and `docker` are registered as `execute` and always remain approval-bound.

For an arbitrary `exec` implementation, Lex can also learn the environment-specific manifest through discovery. The capability classification is only one gate; CRS, trajectory, authorization, and approval still apply.

## Important security boundary

Discovery does **not** mean:

> "The client says this is safe, therefore Lex allows it."

It means:

> "Lex has enough metadata to classify this tool. Now apply the normal governance policy."

Unknown or unresolved tools cannot execute.

## SDK

The official SDK exposes:

```ts
const lex = new LexAureonClient('https://lexaureon.com', process.env.LEX_API_KEY);

const { tools } = await mcpClient.listTools();
await lex.discoverCapabilities(tools);
```

After discovery, the environment can use the normal Lex governance and action-review flows without manually registering every tool.
