/**
 * Kernel Bridge — connects SovereignKernel to Turso
 * Writes kernel receipts into existing audit infrastructure.
 * No new tables. Uses: praxis_receipts, z_traj, governor_log.
 *
 * governor_effort: now OR of two sources (max):
 *   1. result.governor_sensing.correction_magnitude — L2 norm of async G(x,z) delta
 *      applied at the START of this turn from the previous turn's sensing cycle.
 *      This is the primary source — reflects real governor work on ~healthy sessions.
 *   2. result.projection_magnitude — L2 norm of CBF floor projection.
 *      This fires only when M < TAU (0.05) — rare in healthy sessions.
 *   Max of the two is used so both modes of correction are visible.
 *
 * slow_drip: OR(semantic classifier, sigma_viol > SIGMA_THRESHOLD).
 *
 * z_traj: written via proven Banach update rule (lib/kv.ts → updateZTraj).
 *
 * loadKernelZ: exported for route callers to thread session z into runCycle.
 *
 * crsMethod override: optional 4th arg. When the caller resolved an
 *   authoritative CRS via the Python backend (api/python/govern.py), it passes
 *   mergePythonCRS().crs_method here (e.g. 'python-cbf|ccp=...|iec=...|adv=...')
 *   so the persisted crs_method column reflects which engine actually produced
 *   the measurement. When omitted (stream route, refusal path, Python fallback),
 *   the receipt records the TypeScript kernel string exactly as before.
 *
 * SHA-256 receipt (added 2026-06-30): every praxis_receipts row now carries the
 *   cryptographic proof on the same row as the governance record:
 *     input_hash   — SHA-256 of the prompt   (from result.receipt.input_hash)
 *     output_hash  — SHA-256 of the output   (from result.receipt.output_hash)
 *     receipt_hash — SHA-256(state ‖ input_hash ‖ output_hash)
 *   Previously the SHA-256 hashes were computed by the kernel and written only
 *   into lex_memory (prompt_hash / governed_response_hash); the receipt itself
 *   carried no hash and the older audit_log path (saveAudit) was no longer
 *   called by the live routes. This consolidates the proof onto the receipt —
 *   one receipt system, cryptographically verifiable, single source of truth.
 *   The bound receipt_hash lets an auditor recompute and confirm that a given
 *   (state, input, output) triple produced exactly this receipt. Columns are
 *   added idempotently; rows written before this change have NULL hashes.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getClient } from './db';
import { KernelCycleResult, KernelState } from './sovereign_kernel';
import { TAU, Z_RECOVERY } from './aureonics_core';
import { updateZTraj, getZTraj, SIGMA_THRESHOLD } from './kv';
import { logger, errorFields } from './logger';
import { env } from './env';
import { sendOpsAlert } from './notify';

/** Load proven session z-weights from z_traj, or return Z_RECOVERY fallback. */
export async function loadKernelZ(sessionId: string): Promise<[number, number, number]> {
  try {
    const z = await getZTraj(sessionId);
    if (
      z &&
      typeof z.z_c === 'number' && typeof z.z_r === 'number' && typeof z.z_s === 'number' &&
      !(Math.abs(z.z_c - 1/3) < 1e-6 && Math.abs(z.z_r - 1/3) < 1e-6 && Math.abs(z.z_s - 1/3) < 1e-6)
    ) {
      return [z.z_c, z.z_r, z.z_s];
    }
  } catch { /* z_traj not yet created for this session */ }
  return Z_RECOVERY;
}

// ── SHA-256 receipt columns — added idempotently, once per warm lambda ──────
let _hashColsReady = false;
async function ensureHashColumns(db: ReturnType<typeof getClient>): Promise<void> {
  if (_hashColsReady) return;
  const safeAlter = async (sql: string) => {
    try { await db.execute(sql); } catch { /* column already exists */ }
  };
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN input_hash TEXT');
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN output_hash TEXT');
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN receipt_hash TEXT');
  // fix: HMAC signature column, added alongside the existing plain-hash
  // columns above. See computeReceiptSignature() docstring for why a plain
  // SHA-256 hash (receipt_hash, above) is NOT tamper-evident on its own —
  // anyone can recompute it without any secret. signature is.
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN signature TEXT');
  // fix: c_after/r_after/s_after -- the HMAC signature is computed over the
  // FULL state (C, R, S individually), but this table previously only stored
  // m_after (min(C,R,S)). Verification needs to reconstruct the exact signed
  // input, and M alone cannot be inverted back to (C,R,S) -- information is
  // lost. Without these columns, /api/audits/verify could never succeed even
  // on an untampered receipt.
  // 2026-07-20: which key version signed this row ('v1' | 'v1-fallback' |
  // 'unsigned') — previously only baked into the HMAC input, invisible to
  // queries, so fallback-signed rows could not be identified after the fact.
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN signing_key_version TEXT');
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN c_after REAL');
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN r_after REAL');
  await safeAlter('ALTER TABLE praxis_receipts ADD COLUMN s_after REAL');
  _hashColsReady = true;
}

/**
 * Cryptographic receipt hash: binds the governed state to the input and output
 * hashes. SHA-256(state ‖ input_hash ‖ output_hash), state serialized at fixed
 * precision so the digest is reproducible by an independent auditor.
 */
function computeReceiptHash(
  state: { C: number; R: number; S: number },
  M: number,
  inputHash: string,
  outputHash: string,
): string {
  const stateStr = `C=${state.C.toFixed(6)},R=${state.R.toFixed(6)},S=${state.S.toFixed(6)},M=${M.toFixed(6)}`;
  return createHash('sha256').update(`${stateStr}‖${inputHash}‖${outputHash}`).digest('hex');
}

/**
 * fix (2026-07-13) — HMAC SIGNATURE, TAMPER-EVIDENT: receipt_hash above is a
 * PLAIN SHA-256 hash. It has no secret input, so anyone — including someone
 * with direct DB write access — can edit a row's state/M/health_band and
 * recompute a matching receipt_hash from the edited values. It proves
 * internal consistency of a receipt against itself; it proves nothing about
 * whether the receipt was altered after Lex Aureon wrote it.
 *
 * computeReceiptSignature() adds a real HMAC-SHA256 over the same canonical
 * fields PLUS receipt_hash itself, keyed by a server-only secret
 * (AUDITOR_SECRET, matching the naming convention already used in
 * lib/agents/auditor.ts). Recomputing a MATCHING signature requires knowing
 * that secret — a DB edit that doesn't also know the secret produces a
 * signature mismatch, which /api/audits/verify surfaces.
 *
 * Deliberately NOT truncated (unlike lib/agents/auditor.ts's
 * signature.slice(0, 32), which weakens a 256-bit HMAC down to 128 bits of
 * output for no benefit) — full 64 hex char digest.
 *
 * Key policy (hardened 2026-07-20): the old behavior fell back to a
 * hardcoded default key when AUDITOR_SECRET was unset — but this repo is
 * public, so that fallback key is public, and any receipt signed with it is
 * forgeable by anyone (1,804 production receipts were signed this way on
 * 2026-07-14 before the secret was configured). Production now REFUSES to
 * sign with the fallback: auditorSigningKey() throws, the receipt write
 * fails loudly (receipt_persisted=false + ops alert) instead of producing a
 * cryptographically worthless signature. Non-production keeps the fallback
 * so local dev and CI work without secrets — marked v1-fallback, and
 * SIGNING_KEY_VERSION is now PERSISTED on each receipt row so
 * fallback-signed rows are queryable, not just baked invisibly into the HMAC.
 */
export const SIGNING_KEY_VERSION = env.AUDITOR_SECRET ? 'v1' : 'v1-fallback';

/** Shared by kernel receipts, lib/agents/auditor.ts, and /api/lex/verify —
 *  single source of truth for signing-key resolution. */
export function auditorSigningKey(): string {
  const secret = env.AUDITOR_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUDITOR_SECRET is not configured — refusing to sign receipts with the public fallback key in production');
  }
  logger.warn('kernel_bridge.sign', 'AUDITOR_SECRET not set — signing with fallback key (non-production only), receipts marked v1-fallback', {});
  return 'lex-aureon-sovereign-key-2026';
}
const signingKey = auditorSigningKey;

export function computeReceiptSignature(fields: {
  receiptId: string;
  sessionId: string;
  state: { C: number; R: number; S: number };
  M: number;
  healthBand: string;
  inputHash: string;
  outputHash: string;
  receiptHash: string;
  createdAt: string;
}): string {
  const canonical = [
    fields.receiptId,
    fields.sessionId,
    fields.state.C.toFixed(6), fields.state.R.toFixed(6), fields.state.S.toFixed(6),
    fields.M.toFixed(6),
    fields.healthBand,
    fields.inputHash,
    fields.outputHash,
    fields.receiptHash,
    fields.createdAt,
    SIGNING_KEY_VERSION,
  ].join('|');
  return createHmac('sha256', signingKey()).update(canonical).digest('hex');
}

/**
 * Constant-time comparison — a naive `===` on hex strings leaks timing
 * information proportional to how many leading characters match, which is
 * exactly the side channel HMAC verification exists to avoid. Both inputs
 * must be equal length for timingSafeEqual; unequal length is treated as
 * simply not matching rather than throwing.
 */
export function verifyReceiptSignature(fields: Parameters<typeof computeReceiptSignature>[0], signature: string): boolean {
  const expected = computeReceiptSignature(fields);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function writeKernelReceipt(
  sessionId: string,
  turn: number,
  result: KernelCycleResult,
  crsMethod?: string,
): Promise<string> {
  const db = getClient();
  const receiptId = `KRN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const r = result.receipt;

  const mBefore = Math.min(result.receipt.raw_state.C, result.receipt.raw_state.R, result.receipt.raw_state.S);
  const sigmaViol = Math.max(0, TAU - mBefore);

  // ── SHA-256 receipt material ─────────────────────────────────────────────
  // input_hash / output_hash are already computed by the kernel (used elsewhere
  // for lex_memory). receipt_hash binds them to the governed ("after") state, so
  // the receipt itself is cryptographically verifiable.
  const inputHash   = r.input_hash ?? '';
  const outputHash  = r.output_hash ?? '';
  const receiptHash = computeReceiptHash(result.state, result.M, inputHash, outputHash);
  const createdAt   = new Date().toISOString();
  // Signing can refuse (production with AUDITOR_SECRET unset — see
  // auditorSigningKey). The receipt is still persisted, explicitly marked
  // 'unsigned', rather than either signing with a public key (forgeable) or
  // failing the whole turn over a signing-config gap. Queryable via the
  // signing_key_version column.
  let signature = '';
  let signingKeyVersion = SIGNING_KEY_VERSION;
  try {
    signature = computeReceiptSignature({
      receiptId, sessionId, state: result.state, M: result.M,
      healthBand: result.health_band, inputHash, outputHash,
      receiptHash, createdAt,
    });
  } catch (e) {
    signingKeyVersion = 'unsigned';
    logger.error('kernel_bridge.sign', 'receipt signing unavailable — persisting unsigned receipt', errorFields(e));
    void sendOpsAlert(
      'receipt_signing_unavailable',
      'Receipt signing unavailable — receipts are being persisted UNSIGNED',
      `computeReceiptSignature threw for session=${sessionId} turn=${turn}: ${String(e).slice(0, 300)}\n` +
      `Most likely cause: AUDITOR_SECRET unset in production. Set it in Vercel env vars.`,
    );
  }

  // ── governor_effort: max(async G correction, CBF projection) ─────────────
  // Async G(x,z) magnitude: non-zero on turns where sensing fired last turn
  //   and IEC filter passed. This is the primary signal for healthy sessions.
  // CBF projection magnitude: non-zero only when M < TAU (hard floor breach).
  //   Rare in healthy sessions but critical to record when it fires.
  const asyncGovEffort  = result.governor_sensing.correction_magnitude ?? 0;
  const cbfProjEffort   = result.projection_magnitude ?? 0;
  const governorEffort  = Math.max(asyncGovEffort, cbfProjEffort);
  // ── crs_method: Python override when present, else TS kernel string ──────
  // The persisted tag now tells auditors which engine produced the authoritative
  // CRS this turn. Python success → 'python-cbf|...'; fallback/stream/refusal →
  // 'SovereignKernel-v2|θ=...|T=...'. Previously this was always the TS string,
  // so the audit log could not distinguish Python-authoritative turns.
  const crsMethodTag = crsMethod
    ?? `SovereignKernel-v2|θ=${result.theta.toFixed(3)}|T=${result.temperature.toFixed(2)}`;

  // ── Law events for z-weight update ───────────────────────────────────────
  const lawEvents: string[] = [];
  if (result.semantic_signal.attack_type && result.semantic_signal.attack_type !== 'none') {
    lawEvents.push(result.semantic_signal.attack_type);
  }
  if (result.receipt.active_law && !lawEvents.includes(result.receipt.active_law)) {
    lawEvents.push(result.receipt.active_law);
  }

  // ── Restructured 2026-07-20 after the 2026-07-14 incident ────────────────
  // Previously one try block wrapped z_traj update + receipt insert +
  // governor log: when Turso's read quota was exhausted, updateZTraj's read
  // threw FIRST and aborted the receipt insert that followed — 1,802 governed
  // turns served with no receipt while this function still RETURNED the
  // generated receiptId, handing users a receipt id that doesn't exist in the
  // database. Now: each subsystem fails independently; the receipt insert
  // (the core guarantee) gets one retry; and on final failure this returns ''
  // so callers can mark the response receipt_persisted=false instead of
  // presenting an unverifiable id as if it were audit-backed. Final failure
  // also fires a throttled ops alert (see lib/notify.ts sendOpsAlert).

  try { await ensureHashColumns(db); } catch (e) {
    logger.warn('kernel_bridge.write', 'ensureHashColumns failed (continuing)', errorFields(e));
  }

  // ── Update z_traj (proven Banach rule) BEFORE receipt write ──────────────
  // Never retried: the z-update rule is stateful — re-applying it would
  // double-step the trajectory.
  try {
    const currentCRS = { c: result.state.C, r: result.state.R, s: result.state.S };
    const prevCRS    = { c: r.raw_state.C, r: r.raw_state.R, s: r.raw_state.S };
    await updateZTraj(sessionId, currentCRS, prevCRS, result.attack_pressure, lawEvents);
  } catch (e) {
    logger.error('kernel_bridge.write', 'z_traj update failed', errorFields(e));
  }

  // ── Slow-drip: OR(semantic, sigma_viol accumulator) ───────────────────────
  const semanticSlowDrip = result.semantic_signal.attack_type === 'slow_drip' ? 1 : 0;
  let accumulatorSlowDrip = 0;
  try {
    const zTraj = await getZTraj(sessionId);
    if (zTraj && zTraj.sigma_viol > SIGMA_THRESHOLD) {
      accumulatorSlowDrip = 1;
      if (!lawEvents.includes('slow_drip')) lawEvents.push('slow_drip');
    }
  } catch { /* non-fatal */ }

  const slowDrip = Math.max(semanticSlowDrip, accumulatorSlowDrip);

  // ── Write receipt (SHA-256 proof + HMAC signature) — one retry ────────────
  let receiptPersisted = false;
  for (let attempt = 0; attempt < 2 && !receiptPersisted; attempt++) {
    try {
      if (attempt > 0) await new Promise(res => setTimeout(res, 300));
      await db.execute({
        sql: `INSERT OR IGNORE INTO praxis_receipts
                (receipt_id, session_id, turn, pre_eval_label,
                 m_before, m_after, governor_mode, intervention,
                 slow_drip, governor_effort, sigma_viol, crs_method,
                 input_hash, output_hash, receipt_hash, signature,
                 signing_key_version, c_after, r_after, s_after, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          receiptId, sessionId, turn, 'CLEAR',
          mBefore,
          result.M,
          `kernel-${result.health_band.toLowerCase()}`,
          result.receipt.safety_projection_triggered ? 1 : 0,
          slowDrip,
          governorEffort,
          sigmaViol,
          crsMethodTag,
          inputHash,
          outputHash,
          receiptHash,
          signature,
          signingKeyVersion,
          result.state.C,
          result.state.R,
          result.state.S,
          createdAt,
        ],
      });
      receiptPersisted = true;
    } catch (e) {
      logger.error('kernel_bridge.write', `receipt write failed (attempt ${attempt + 1}/2)`, errorFields(e));
      if (attempt === 1) {
        void sendOpsAlert(
          'receipt_write_failed',
          'Audit receipt write failing — governed turns are being served WITHOUT receipts',
          `praxis_receipts insert failed twice for session=${sessionId} turn=${turn} at ${createdAt}.\n` +
          `Error: ${String(e).slice(0, 300)}\n\n` +
          `The response was returned with receipt_persisted=false. If this is a Turso quota ` +
          `exhaustion (see 2026-07-14 incident), reads/writes stay blocked until quota resets or the plan is upgraded.`,
        );
      }
    }
  }

  // ── Governor log — best-effort, independent of the receipt ────────────────
  try {
    const driftDir = result.delta_V < -0.001 ? 'converging'
      : result.delta_V > 0.001 ? 'diverging' : 'stable';

    await db.execute({
      sql: `INSERT INTO governor_log
              (session_id, turn, m_before, m_after, drift_dir,
               sigma_viol, intervention, law_fired, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId, turn,
        mBefore, result.M, driftDir, sigmaViol,
        result.receipt.safety_projection_triggered ? 'cbf_projection'
          : slowDrip ? 'slow_drip_accumulator'
          : asyncGovEffort > 0 ? 'async_governor'
          : 'none',
        result.receipt.active_law || (result.semantic_signal.attack_type !== 'none'
          ? `semantic:${result.semantic_signal.attack_type}` : null),
        new Date().toISOString(),
      ],
    });
  } catch (e) {
    logger.error('kernel_bridge.write', 'governor_log write failed', errorFields(e));
  }

  return receiptPersisted ? receiptId : '';
}

export async function loadKernelState(sessionId: string): Promise<KernelState | null> {
  try {
    const db = getClient();
    const res = await db.execute({
      sql: 'SELECT last_c, last_r, last_s FROM z_traj WHERE session_id = ? LIMIT 1',
      args: [sessionId],
    });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return { C: Number(row.last_c), R: Number(row.last_r), S: Number(row.last_s) };
  } catch {
    return null;
  }
}
