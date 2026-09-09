# Production readiness and reproducibility

## Release gates

Every change to `main` runs the CI workflow in `.github/workflows/ci.yml`. The workflow installs from the lockfile, runs linting, strict TypeScript checking, the unit and integration suite, coverage generation, a production-only dependency audit, the Next.js production build, the static-receipt regression guard, and a Docker image build. A release is not considered green unless every gate passes.

The production-only audit intentionally excludes development tooling from the deployable graph. Development dependency findings remain visible through the normal npm audit report and must be reviewed during dependency upgrades; they are not silently ignored in release planning.

## Deployment verification

After a production deployment, verify the following endpoints:

```bash
curl -fsS https://www.lexaureon.com/api/health
curl -fsS https://www.lexaureon.com/robots.txt
curl -fsS https://www.lexaureon.com/sitemap.xml
```

The health response must report `ok: true`, `status: "ok"`, `kernel_active: true`, and readable storage. Provider configuration is reported as configured or unavailable without exposing secret values. A successful HTTP response alone is insufficient: the storage and kernel fields must also be checked.

## Runtime secrets

`NEXT_PUBLIC_SITE_URL` is a public build-time value and defaults to the canonical production URL when absent. Private provider, database, administrator, cron, and signing secrets remain strict at runtime and must be supplied by the deployment environment. Production receipt signing must use `AUDITOR_SECRET`; the development fallback signer is rejected in production.

## Data protection and recovery

Turso is the system of record for sessions, trajectories, receipts, benchmark publications, and operational counters. Before a production schema migration or destructive maintenance operation:

1. record the current schema and migration identifier;
2. export or snapshot the affected tables using the database provider's protected backup mechanism;
3. run a restore into an isolated database;
4. verify receipt hashes, signature metadata, and row counts after restore;
5. record the restore result and the operator in the deployment change log.

The application must fail closed for high-risk governed actions when constitutional state or mandatory receipt persistence is unavailable. A degraded response must be labeled as degraded and must never look like a fully persisted governance decision.

## Evidence boundaries

A signed receipt proves content integrity and possession of the signing key. It does not prove that a benchmark was independently reproduced or that an analytical theorem holds. Numerical simulator certificates are finite-horizon evidence. The analytical multi-pillar Lyapunov proof and complete production descent alignment remain open research items and must not be described as closed in release copy.

## Reproducible evaluation records

Published evaluation artifacts should include the dataset revision, prompt count, random seed, base and governed model identifiers, provider, temperature, system-prompt hash, judge version, scoring rule, skipped-row count, and confidence interval method. A result without those fields is an internal observation rather than an independently reproducible benchmark claim.
