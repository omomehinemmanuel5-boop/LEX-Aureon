# Security model

## Public endpoints

Public governance requests are protected by JSON body-size limits, prompt and session bounds, integer bounds for turn numbers, optional API-key validation, IP-based sliding-window limits, generic client-facing errors, structured server-side logging, and no-store response headers.

Anonymous callers receive a smaller budget than authenticated API-key callers. API keys also have plan-level run allowances tracked in Turso.

## Sensitive areas

Admin, benchmark publishing, cron, key management, debug, and tool-proxy routes require separate review. Do not expose these routes through the public demo without an explicit authentication decision.

## Reporting a vulnerability

Do not include secrets, tokens, private keys, database exports, or exploit payloads in a public issue. Contact the maintainer privately with the affected route, impact, reproduction steps, and a minimal sanitized example.

## Security review checklist

- Confirm auth is enforced before expensive provider or database work.
- Confirm rate-limit failures and database failures are observable.
- Confirm logs never include bearer tokens or raw API keys.
- Confirm errors do not reveal provider URLs, SQL, stack traces, or credentials.
- Confirm governance-math changes include regression tests and research-status updates.
