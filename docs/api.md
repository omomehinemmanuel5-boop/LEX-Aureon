# Lex Aureon API guide

Base URL: https://www.lexaureon.com

## Govern a request

POST /api/lex/govern accepts JSON with prompt, session_id, turn, and optional identity_mode. The response contains the governed output and constitutional receipt.

## Authentication and limits

Authentication is optional for the public demo, but recommended for integrations: send x-lex-api-key: lex_sk_..., or Authorization: Bearer lex_sk_....

Anonymous requests are limited to 20 requests per IP per minute. Authenticated requests are limited to 120 requests per IP per minute and also consume the API key plan allowance. A 429 response includes Retry-After.

## Errors

- 400 invalid JSON or input
- 401 invalid or exhausted API key
- 413 request body too large
- 429 rate limit exceeded
- 500 temporary backend failure; internal details are not returned

## Verification

Use GET /api/lex/verify and the public audit page to inspect receipt verification. A numerical simulator certificate is not proof of the open multi-pillar analytical result.

## SDKs

The TypeScript SDK lives under `sdk/typescript` and the Python SDK lives under `sdk/python`. Both accept an optional `apiKey` or `api_key` configuration value and send it as an `Authorization: Bearer` token. Both preserve request and session identifiers for receipt correlation.

TypeScript:

```ts
const client = new LexAureonClient({
  baseURL: 'https://lexaureon.com',
  sessionId: 'production-session-1',
  apiKey: process.env.LEX_API_KEY,
});
```

Python:

```python
client = LexAureonClient(
    base_url="https://lexaureon.com",
    session_id="production-session-1",
    api_key=os.environ["LEX_API_KEY"],
)
```

Do not hard-code API keys in source control. A valid receipt proves the bound data and signing key relationship; it does not independently prove that a benchmark was complete or that its scoring methodology was valid.
