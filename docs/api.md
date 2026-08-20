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

The TypeScript SDK lives under sdk/typescript and the Python SDK lives under sdk/python. Both should send the API key as a bearer token and preserve request and session identifiers for receipt correlation.
