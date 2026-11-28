# Lex Aureon ChatGPT plugin package

This package connects the Lex Aureon remote MCP server to ChatGPT-compatible plugin hosts.

- MCP endpoint: https://www.lexaureon.com/api/mcp
- Authentication: OAuth authorization code with PKCE and Dynamic Client Registration.
- User identity: verified Lex account, bound to a tenant-scoped free-tier connection credential.
- Public access: public governance tools only. Operator, private-test, and sovereign privileges are not granted by installation.
- Consequential actions: governed by Lex policy and explicit approval requirements.

## Local validation

Use the repository marketplace entry at `.agents/plugins/marketplace.json` in a supported ChatGPT desktop/Codex environment. Public availability requires submission through OpenAI's plugin submission portal and successful review; this package alone does not publish the plugin.

## Submission blockers to clear

- Run current-head CI and the end-to-end OAuth/PKCE connection test.
- Confirm the live privacy policy and provide a published terms-of-service URL if required by the submission portal.
- Add final approved brand icon and logo assets.
- Complete OpenAI review and publication.
