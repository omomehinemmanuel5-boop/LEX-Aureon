# Lex Aureon ChatGPT app submission materials

This directory contains a reusable MCP connection configuration and descriptive metadata for Lex Aureon. The official review-facing submission file is at the repository root: `chatgpt-app-submission.json`.

## MCP server

- Endpoint: https://www.lexaureon.com/api/mcp
- Authentication: OAuth authorization code with PKCE (S256) and Dynamic Client Registration.
- User identity: verified Lex account, bound to a tenant-scoped free-tier connection credential.
- Public access: the public governance tool allowlist only. Installation does not grant operator, private-test, or sovereign privileges.
- Consequential actions: remain subject to Lex policy and separate human approval.

## Submission workflow

1. Validate the latest pull-request commit with GitHub Actions and a live preview connection.
2. Review `chatgpt-app-submission.json` against the actual MCP tool behavior and update its test cases if the public tool surface changes.
3. In the OpenAI Apps submission flow, provide the MCP server URL and upload the submission JSON to prefill app information and test cases.
4. Complete the requested ownership/domain verification and app review steps.

The repository manifest and local marketplace entry do not publish the app to ChatGPT. Public availability requires submission and successful OpenAI review.

## Remaining review items

- Current-head CI and end-to-end OAuth/PKCE connection must pass.
- Review the privacy policy at https://www.lexaureon.com/privacy, which now describes account and OAuth data processing.
- Add final approved app icon and branding assets if requested by the submission form.
- Review all tool descriptions and annotation justifications against the live public tool list.
- OpenAI review and publication remain external approval steps.
