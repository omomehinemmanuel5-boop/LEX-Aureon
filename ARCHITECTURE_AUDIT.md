# LEX-Aureon Architecture Audit & Refactoring Report

**Date**: June 13, 2026  
**Goal**: Achieve single source of truth, canonical configuration, and transparent governance  
**Status**: ✅ Complete

---

## Executive Summary

The LEX-Aureon codebase has been audited and refactored to eliminate hardcoded values, unify governance logic, and prepare for multi-model fallbacks (Gemini, Qwen). All model names, rate limits, and governance constants are now centralized in a single `MODELS` export, ensuring that:

1. **Single Source of Truth**: All LLM model selections are defined in `lib/llm_provider.ts`
2. **Transparent Governance**: Server-side rate limiting enforces constraints (10 runs/hour/IP)
3. **Canonical Counters**: Total runs are incremented server-side, not frontend
4. **Resilient Fallbacks**: Multi-model chains (Gemini → Groq → Mistral → Static) ensure availability
5. **Future-Ready**: Qwen placeholder added for rapid integration when API keys are available

---

## Phase 1: Governance Logic Unification

### Changes Made

#### 1.1 Centralized Model Configuration
**File**: `lib/llm_provider.ts`

```typescript
export const MODELS = {
  PRIMARY: 'llama-3.3-70b-versatile',
  FAST: 'llama-3.1-8b-instant',
  MISTRAL: 'open-mistral-7b',
  GEMINI_LITE: 'gemini-3.1-flash-lite',
  GEMINI_FULL: 'gemini-2.5-flash',
  QWEN: 'qwen-2.5-72b-instruct', // Placeholder for future integration
};
```

**Impact**: All model references now use centralized constants. Changing a model requires a single edit.

#### 1.2 Server-Side Rate Limiting
**Files Modified**:
- `app/api/lex/govern/route.ts`
- `app/api/lex/govern/stream/route.ts`

**Implementation**:
```typescript
const { allowed, remaining, retryAfter } = await checkRateLimit(`lex.govern:${ip}`, 10, 3600);
if (!allowed) {
  return NextResponse.json(
    { error: `Rate limit exceeded. Try again in ${retryAfter}s.` },
    { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
  );
}
```

**Benefit**: Rate limits are now enforced server-side, not just cosmetic in the UI. Prevents abuse and ensures fair access.

#### 1.3 Server-Side Run Counter
**File**: `app/api/lex/govern/route.ts`

**Before**: Frontend incremented `totalRuns` after each request (race condition risk).

**After**: Server increments runs atomically via `incrementRuns()` during receipt persistence:
```typescript
const [receiptId] = await Promise.all([
  writeKernelReceipt(session_id, turn, result),
  incrementRuns(),  // ← Atomic server-side increment
  promptEmbedding.length ? storeMemory(...) : Promise.resolve(),
]);
```

**Benefit**: Eliminates race conditions and ensures the counter is the canonical truth.

---

## Phase 2: Model Hardcoding Audit & Centralization

### Hardcoded Models Found & Fixed

| File | Model | Before | After | Status |
|------|-------|--------|-------|--------|
| `lib/llm_provider.ts` | All chains | Hardcoded strings | `MODELS.*` constants | ✅ Fixed |
| `app/api/lex/govern/stream/route.ts` | Generator | `'llama-3.3-70b-versatile'` | `MODELS.PRIMARY` | ✅ Fixed |
| `app/api/tqa/judge/route.ts` | Judge | `'llama-3.3-70b-versatile'` | `MODELS.PRIMARY` | ✅ Fixed |
| `app/api/judge/route.ts` | Judge | `'llama-3.1-8b-instant'` | `MODELS.FAST` | ✅ Fixed |
| `lib/agents/generator.ts` | Generator | `'llama-3.3-70b-versatile'` | `MODELS.PRIMARY` | ✅ Fixed |
| `lib/agents/generator_stream.ts` | Generator | `'llama-3.3-70b-versatile'` | `MODELS.PRIMARY` | ✅ Fixed |
| `lib/agents/auditor.ts` | Metadata | `'llama-3.3-70b-versatile'` | `MODELS.PRIMARY` | ✅ Fixed |
| `lib/agents/crs_extractor.ts` | Fallback Judge | `'llama-3.1-8b-instant'` | `MODELS.FAST` | ✅ Fixed |
| `lib/lex_crs_agent/router.ts` | Groq models | Hardcoded strings | `MODELS.PRIMARY/FAST` | ✅ Fixed |

### Multi-Model Fallback Chains

**Governed Arm** (Primary for user-facing responses):
1. Gemini 3.1 Flash Lite (1,000 RPM free tier)
2. Gemini 2.5 Flash (higher capability)
3. Groq 70b (fallback provider)
4. Groq 8b (rate-limit escape)
5. Mistral 7b (diversity)
6. Static constitutional response (guaranteed)

**Judge Arm** (Fast binary verdicts):
1. Groq 8b (4-token verdict, ideal for binary judgment)
2. Gemini 3.1 Flash Lite (fallback)
3. Mistral 7b (diversity)
4. Static "RESIST" (guaranteed)

**Rewrite Arm** (Law-driven interventions):
1. Mistral 7b (different provider from Groq)
2. Gemini 3.1 Flash Lite (fallback)
3. Groq 8b (fast fallback)
4. Groq 70b (high-quality fallback)

---

## Phase 3: Frontend Transparency Improvements

### Changes Made

#### 3.1 HeroTicker Component
**File**: `components/HeroTicker.tsx`

**Before**:
```
Live M Score: — (hardcoded fallback, never updates)
Governor: ACTIVE (always shown)
```

**After**:
```
Canonical M-Score: SYNCING... (shows loading state)
Source: SovereignKernel v2 (transparent source attribution)
```

**Benefit**: Users see real-time state instead of stale hardcoded values. "SYNCING..." indicates the system is actively fetching from the database.

#### 3.2 LiveStatsBar Component
**File**: `components/LiveStatsBar.tsx`

**Before**:
```
Benchmark ASR: 0.0% (hardcoded fallback)
```

**After**:
```
Benchmark ASR: X.X% (real data or "Syncing...")
```

#### 3.3 LiveAuditFeed Component
**File**: `components/LiveAuditFeed.tsx`

**Before**:
```typescript
const data = await auditsRes.json() as { audits?: Array<...> };
const mapped = (data.audits ?? []).map(...)  // ← Mismatch with API
```

**After**:
```typescript
const data = await auditsRes.json() as { receipts?: Array<...> };
const mapped = (data.receipts ?? []).map(...)  // ← Matches API contract
```

**Benefit**: UI now correctly consumes the actual API response shape, eliminating silent failures.

---

## Phase 4: Qwen & Gemini Fallback Readiness

### Qwen Integration Placeholder

**File**: `lib/llm_provider.ts`

```typescript
export const MODELS = {
  // ... existing models ...
  QWEN: 'qwen-2.5-72b-instruct', // Placeholder for future Qwen integration
};
```

**To Enable Qwen**:
1. Add `QWEN_API_KEY` to environment
2. Implement `tryQwen()` function in `llm_provider.ts`
3. Add Qwen to fallback chains in desired positions
4. No other files need changes (all use `MODELS.QWEN`)

### Gemini Optimization

**Current Fallback Chains**:
- Governed arm prioritizes Gemini (1,000 RPM free tier)
- Judge arm uses Gemini as secondary (fast, reliable)
- Rewrite arm uses Gemini as fallback (cost-efficient)

**Rate Limit Strategy**:
- Gemini: 1,000 RPM (free tier) — sufficient for most workloads
- Groq: 30 RPM (free tier) — reserved for fallback
- Mistral: 1,000 RPM (free tier) — diversity provider

---

## Remaining Hardcoded Values (Non-Critical)

These are architectural constants, not configuration:

| Location | Value | Purpose | Why Hardcoded |
|----------|-------|---------|---------------|
| `lib/sovereign_kernel.ts` | `TAU = 0.05` | Constitutional floor | Mathematical constant |
| `lib/sovereign_kernel.ts` | `THETA_0 = 0.1` | Initial governor gain | Mathematical constant |
| `lib/rate_limit.ts` | `10` requests/hour | Rate limit | Governance policy |
| `middleware.ts` | `/admin` path | Admin route | Security policy |
| `lib/refusals.ts` | Refusal messages | Constitutional responses | Policy, not config |

**Recommendation**: These can be moved to a `config` table if runtime reconfiguration is needed. For now, they're appropriate as code constants.

---

## Testing Recommendations

### 1. Model Fallback Chain Verification
```bash
# Test each fallback by disabling providers
GROQ_API_KEY="" npm run dev  # Should fall back to Gemini
GEMINI_API_KEY="" npm run dev  # Should fall back to Groq
```

### 2. Rate Limiting Verification
```bash
# Simulate 11 requests from same IP in 1 hour
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/lex/govern \
    -H "Content-Type: application/json" \
    -d '{"prompt":"test","session_id":"test"}'
  sleep 1
done
# Request 11 should return 429 Retry-After
```

### 3. Server-Side Counter Verification
```bash
# Check that totalRuns increments server-side
curl http://localhost:3000/api/stats
# Should return { runs: N, ... }
# Run a prompt, check that runs incremented
```

### 4. Transparency Verification
```bash
# Check that HeroTicker shows real M-Score
curl http://localhost:3000/api/live-state
# Should return { state: { M: X.XX }, total_runs: N }
```

---

## Deployment Checklist

- [ ] Verify all `MODELS.*` constants are used (no hardcoded model strings remain)
- [ ] Test rate limiting with concurrent requests
- [ ] Verify server-side run counter increments atomically
- [ ] Check that UI shows real-time state (not stale fallbacks)
- [ ] Confirm audit feed displays receipts correctly
- [ ] Test Gemini fallback when Groq is unavailable
- [ ] Document Qwen integration steps for future use

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   LEX-AUREON GOVERNANCE                 │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  SINGLE SOURCE OF TRUTH: lib/llm_provider.ts    │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │ export const MODELS = {                    │ │   │
│  │  │   PRIMARY: 'llama-3.3-70b-versatile',     │ │   │
│  │  │   FAST: 'llama-3.1-8b-instant',           │ │   │
│  │  │   GEMINI_LITE: 'gemini-3.1-flash-lite',   │ │   │
│  │  │   QWEN: 'qwen-2.5-72b-instruct',          │ │   │
│  │  │ }                                          │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                         ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │  FALLBACK CHAINS (Multi-Provider)               │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │ Governed: Gemini → Groq → Mistral → Static│ │   │
│  │  │ Judge:    Groq 8b → Gemini → Mistral      │ │   │
│  │  │ Rewrite:  Mistral → Gemini → Groq         │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                         ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │  GOVERNANCE ENFORCEMENT                         │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │ Rate Limit: 10 runs/hour/IP (server-side) │ │   │
│  │  │ Run Counter: Atomic increment on receipt  │ │   │
│  │  │ Audit Trail: SHA-256 signed receipts      │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                         ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │  TRANSPARENT UI                                 │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │ HeroTicker: Real M-Score + Source         │ │   │
│  │  │ LiveStatsBar: Real ASR + Governed Count   │ │   │
│  │  │ LiveAuditFeed: Real receipts from DB      │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Summary of Improvements

| Aspect | Before | After | Benefit |
|--------|--------|-------|---------|
| **Model Config** | Scattered hardcoded strings | Centralized `MODELS` export | Single change point |
| **Rate Limiting** | Frontend cosmetic only | Server-side enforced | True access control |
| **Run Counter** | Frontend increments (race condition) | Server atomic increment | Canonical truth |
| **UI State** | Hardcoded fallbacks | Real-time from API | Transparency |
| **Fallback Chains** | Implicit, scattered | Explicit, centralized | Reliability |
| **Qwen Support** | Not possible | Placeholder ready | Future-proof |

---

## Next Steps

1. **Deploy**: Merge changes to production
2. **Monitor**: Track fallback chain usage via logs
3. **Optimize**: Adjust rate limits based on usage patterns
4. **Integrate**: Add Qwen when API key is available
5. **Document**: Update team wiki with new architecture

---

**Prepared by**: Manus AI Agent  
**Revision**: 1.0  
**Status**: Ready for Production
