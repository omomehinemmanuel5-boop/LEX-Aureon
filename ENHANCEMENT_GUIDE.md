# Lex Aureon Enhancement Guide

This document describes the non-disruptive enhancements added to Lex Aureon to bring it to the "best level" while maintaining 100% uptime on the live site.

## Overview

The enhancements are organized into four phases, each designed to be independent and backward-compatible:

1. **SDK Development** — Official TypeScript and Python SDKs
2. **Containerization** — Docker support for local development
3. **Performance Optimization** — Embedding caching layer
4. **CI/CD & Testing** — Automated benchmarking and validation

## Phase 1: SDK Development

### What Changed

Two new SDKs have been added under `/sdk`:

- **TypeScript SDK** (`sdk/typescript/`) — Drop-in governance layer for Node.js and browser environments
- **Python SDK** (`sdk/python/`) — Full-featured governance client for Python applications

### Why This Matters

Previously, users had to make raw HTTP calls to the governance API. The SDKs provide:
- Type-safe interfaces
- Automatic retries with exponential backoff
- Batch processing support
- Health checks
- Session management

### Zero-Risk Implementation

The SDKs are **completely independent** of the main application. They:
- Live in a separate `/sdk` directory
- Have their own `package.json` and `setup.py`
- Do not import or modify any core application code
- Can be published to npm and PyPI independently

### How to Use

#### TypeScript

```bash
npm install @lex-aureon/sdk
```

```typescript
import { LexAureonClient } from '@lex-aureon/sdk';

const client = new LexAureonClient({
  baseURL: 'https://lexaureon.com',
  sessionId: 'user-123'
});

const result = await client.govern({
  prompt: 'Your input',
  turn: 1
});
```

#### Python

```bash
pip install lex-aureon
```

```python
from lex_aureon import LexAureonClient

client = LexAureonClient(base_url='https://lexaureon.com')
result = client.govern(prompt='Your input', turn=1)
print(result.governed_output)
```

### Documentation

Full SDK documentation is available in `/sdk/README.md`.

## Phase 2: Containerization

### What Changed

Three new files enable Docker-based local development:

- **`Dockerfile`** — Multi-stage production build
- **`docker-compose.yml`** — Orchestration for local development
- **`.dockerignore`** — Optimization for build context

### Why This Matters

Developers can now:
- Run the entire stack locally without manual setup
- Ensure parity between local and production environments
- Test changes in an isolated container
- Easily onboard new contributors

### Zero-Risk Implementation

The Docker configuration:
- Does not modify any application code
- Uses the existing `package.json` and build scripts
- Respects all existing environment variables
- Includes health checks for verification

### How to Use

```bash
# Copy environment template
cp .env.local.example .env.local

# Edit .env.local with your API keys
# GROQ_API_KEY=...
# JINA_API_KEY=...
# etc.

# Start the application
docker-compose up

# Application is available at http://localhost:3000
```

### Health Check

The Docker container includes a health check that verifies the `/api/health` endpoint. The application is considered healthy when:
- The health endpoint responds with HTTP 200
- Turso database is accessible
- At least one LLM provider is available

## Phase 3: Performance Optimization

### What Changed

Two new files add an optional embedding caching layer:

- **`lib/embedding_cache.ts`** — Cache layer for Jina embeddings
- **`lib/lex_memory_enhanced.ts`** — Drop-in replacement for `lex_memory.ts` with caching

### Why This Matters

The embedding cache:
- Reduces Jina API calls for repeated or similar prompts
- Improves latency (cache hits are instant)
- Lowers operational costs
- Maintains 100% backward compatibility

### Zero-Risk Implementation

The caching layer:
- Uses an **additive** database table (`embedding_cache`)
- Never modifies existing tables or data
- Fails gracefully — if cache is unavailable, the system continues without it
- Can be enabled/disabled via a simple import change
- Includes automatic pruning of old entries

### How to Use

#### Option 1: Enable Caching (Recommended)

Update `app/api/lex/govern/route.ts`:

```typescript
// Change this line:
// import { embedText, ... } from '@/lib/lex_memory';

// To this:
import { embedText, ... } from '@/lib/lex_memory_enhanced';
```

That's it. The caching layer is now active.

#### Option 2: Keep Current Behavior

No changes needed. The system continues to work exactly as before.

### Cache Statistics

Monitor cache performance via the admin console or by calling:

```typescript
import { getCacheStats } from '@/lib/embedding_cache';

const stats = await getCacheStats();
console.log(`Cache hits: ${stats.total_hits}`);
console.log(`Cache size: ${stats.cache_size_bytes} bytes`);
```

### Pruning Old Entries

Add this to your cron job or startup script:

```typescript
import { pruneEmbeddingCache } from '@/lib/embedding_cache';

// Remove entries older than 30 days
await pruneEmbeddingCache(30);
```

## Phase 4: CI/CD & Testing

### What Changed

A new GitHub Actions workflow has been added:

- **`.github/workflows/benchmark.yml`** — Automated benchmarking on every PR

### Why This Matters

The workflow:
- Runs all four safety benchmarks (HarmBench, JailbreakBench, AdvBench, TruthfulQA) on every PR
- Ensures no regression in constitutional safety
- Provides a "green light" before merging
- Catches issues early in the development cycle

### Zero-Risk Implementation

The workflow:
- Only runs on pull requests and pushes to `main` or `enhancement/**` branches
- Uses the same scripts you already have (`npm run harmbench`, etc.)
- Requires the same environment variables as the live site
- Uploads results as artifacts for review

### How to Use

1. **On Pull Request**: The workflow automatically runs all benchmarks
2. **Review Results**: Check the workflow output in the PR
3. **Merge with Confidence**: Only merge when all benchmarks pass

### Secrets Configuration

To enable the workflow, add these secrets to your GitHub repository settings:

- `GROQ_API_KEY`
- `JINA_API_KEY`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `ADMIN_PASSWORD`
- `CRON_SECRET`

## Environment Validation

A new script validates your environment before startup:

```bash
npx ts-node scripts/validate-env.ts
```

This checks:
- All required environment variables are set
- Turso database is accessible
- Groq API is reachable
- Jina embeddings API is reachable

The script is also run automatically in Docker and GitHub Actions.

## Migration Path

### To Adopt These Enhancements

1. **SDKs**: Publish to npm and PyPI (optional — they work as-is)
2. **Docker**: Test locally, then deploy to production
3. **Caching**: Enable gradually by switching the import
4. **CI/CD**: Configure GitHub secrets and merge the workflow

### To Keep Current Behavior

You don't have to do anything. All enhancements are:
- Additive (no breaking changes)
- Optional (can be ignored)
- Backward-compatible (existing code continues to work)

## Rollback Plan

If any enhancement causes issues:

1. **SDKs**: Simply don't use them — they're independent
2. **Docker**: Revert to the previous deployment method
3. **Caching**: Switch back to `import { embedText } from '@/lib/lex_memory'`
4. **CI/CD**: Disable the workflow in GitHub Actions

## Testing Checklist

Before merging this PR, verify:

- [ ] Local development works with Docker Compose
- [ ] All existing tests pass (`npm test`)
- [ ] Benchmarks pass (`npm run harmbench`, etc.)
- [ ] Environment validation passes (`npx ts-node scripts/validate-env.ts`)
- [ ] SDK examples work (see `/sdk/README.md`)
- [ ] No changes to existing API behavior
- [ ] No new environment variables are required
- [ ] Database migrations are idempotent

## Support

For questions or issues with these enhancements:

1. Check the documentation in each directory
2. Review the code comments
3. Open an issue on GitHub
4. Contact: lexaureon@gmail.com

## Next Steps

After merging this PR, consider:

1. Publishing SDKs to npm and PyPI
2. Adding SDK examples to the documentation site
3. Monitoring cache hit rates and adjusting TTL if needed
4. Expanding CI/CD to include performance benchmarks
5. Adding OpenTelemetry tracing for observability

---

**Version**: 1.0.0  
**Date**: June 2026  
**Author**: Manus Enhancement Bot  
**Status**: Ready for Review
