# Security model

## Public endpoints

Public governance requests are protected by JSON body-size limits, prompt and session bounds, integer bounds for turn numbers, optional API-key validation, IP-based sliding-window limits, generic client-facing errors, structured server-side logging, and no-store response headers.

Anonymous callers receive a smaller budget than authenticated API-key callers. API keys also have plan-level run allowances tracked in Turso.

## Sensitive areas

Admin, benchmark publishing, cron, key management, debug, and tool-proxy routes require separate review. Do not expose these routes through the public demo without an explicit authentication decision.

## Reporting a vulnerability

Do not include secrets, tokens, private keys, database exports, or exploit payloads in a public issue. Contact the maintainer privately with the affected route, impact, reproduction steps, and a minimal sanitized example.

## Receipt integrity

Governance receipts bind the input, output, and constitutional state through hashes. Evaluation artifacts under `lib/artifact_signer.ts` additionally use Ed25519 signatures so a verifier can check both content integrity and possession of the signing key. Receipt verification must fail closed when a signature, public key, or bound hash is invalid. Hashes alone are not an authenticity mechanism.

Signing keys must remain outside the repository, use restrictive file permissions, and be rotated according to the deployment's operational policy. A valid signature proves that the artifact was signed by the corresponding key; it does not by itself prove that the run was complete, independently reproduced, or scientifically valid.

## Dependency failure policy

The application must document whether each dependency failure is fail-open, fail-closed, or degraded. In particular, database, embedding-provider, model-provider, and receipt-persistence failures must not silently be presented as a healthy, fully auditable governance decision. High-risk external or destructive actions should require an explicit policy decision when current constitutional state or receipt persistence is unavailable.

## Security review checklist

- Confirm auth is enforced before expensive provider or database work.
- Confirm rate-limit failures and database failures are observable.
- Confirm logs never include bearer tokens or raw API keys.
- Confirm errors do not reveal provider URLs, SQL, stack traces, or credentials.
- Confirm governance-math changes include regression tests and research-status updates.
