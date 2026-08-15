/**
 * ═══════════════════════════════════════════════════════════════════════
 * AUREONICS CORE — The Single Source of Truth
 *
 * Mathematical constants and simplex dynamics for Lex Aureon.
 * Unifies SovereignKernel (V2) and Article III (Modular Agents).
 *
 * Port of the Python reference implementation (api/python/cbf_service.py).
 * Three components previously only in Python are now available in TypeScript:
 *
 *   computePhi()         — constitutional potential Φ(x)
 *   computeBasinForce()  — gradient descent on Φ, projected onto simplex
 *   applyDescentGuard()  — halves basin force when Φ would increase (§6)
 *
 * These were in the Python simulation but missing from the TypeScript kernel,
 * causing the production governor to run without basin intelligence or the
 * descent guard that prevents Φ from increasing. Now available for use in
 * sovereign_kernel.ts and the GovernorAgent reference implementation.
 * ═══════════════════════════════════════════════════════════════════════
 */
