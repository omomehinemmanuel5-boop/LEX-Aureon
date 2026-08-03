/**
 * Tests for differential sovereignty scoring (2026-08-03 improvement).
 *
 * The fix: sovereignty is scored on the OUTPUT-INPUT delta, not the full output.
 * This prevents benign factual answers from being penalized for topic distance
 * from constitutional vocabulary.
 */
import { describe, it, expect } from 'vitest';
import {
  computeSelfReferentialCRS,
  cosineSimilarityVec,
  computeCentroid,
} from '../lib/self_referential_crs';

// Helper: create a simple embedding vector with a given "direction"
function makeVec(dim: number, value: number): number[] {
  return new Array(dim).fill(value / Math.sqrt(dim));
}

describe('cosineSimilarityVec', () => {
  it('returns 0.5 for empty vectors', () => {
    expect(cosineSimilarityVec([], [])).toBe(0.5);
    expect(cosineSimilarityVec([1, 2, 3], [])).toBe(0.5);
    expect(cosineSimilarityVec([], [1, 2, 3])).toBe(0.5);
  });

  it('returns 1 for identical unit vectors', () => {
    const v = makeVec(128, 1);
    expect(cosineSimilarityVec(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Array(128).fill(0);
    const b = new Array(128).fill(0);
    a[0] = 1;
    b[1] = 1;
    expect(cosineSimilarityVec(a, b)).toBeCloseTo(0, 5);
  });
});

describe('computeCentroid', () => {
  it('returns null for empty input', () => {
    expect(computeCentroid([])).toBeNull();
  });

  it('averages embeddings correctly', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const centroid = computeCentroid([a, b]);
    expect(centroid).toEqual([0.5, 0.5, 0]);
  });
});

describe('Differential Sovereignty Scoring', () => {
  const DIM = 128;

  it('benign factual answer does NOT trigger sovereignty violation', () => {
    // Constitutional centroid: aligned with constitutional vocabulary
    const constitutionalCentroid = makeVec(DIM, 0.8);

    // Input: a question about a benign topic
    const inputEmb = makeVec(DIM, 0.3);

    // Output: a factual answer about the same benign topic
    // The output is in the same register as the input — minimal delta.
    const outputEmb = makeVec(DIM, 0.35);

    const result = computeSelfReferentialCRS(
      outputEmb, inputEmb, constitutionalCentroid, null,
    );

    // Sovereignty should NOT be violated — the delta is tiny
    expect(result.sovereignty_violated).toBe(false);
    expect(result.sovereignty_raw).toBeGreaterThan(0.15);
  });

  it('large topic-shift answer still scores the delta, not the full output', () => {
    const constitutionalCentroid = makeVec(DIM, 0.8);

    // Input: "What is the capital of France?"
    const inputEmb = makeVec(DIM, 0.4);

    // Output: "Paris is the capital of France, located in..." (same register)
    // Even though the output is "about Paris", the delta from input is small
    const outputEmb = makeVec(DIM, 0.42);

    const result = computeSelfReferentialCRS(
      outputEmb, inputEmb, constitutionalCentroid, null,
    );

    // Should NOT violate — delta is minimal
    expect(result.sovereignty_violated).toBe(false);
  });

  it('neutral fallback when no delta exists (input ≈ output)', () => {
    const constitutionalCentroid = makeVec(DIM, 0.8);
    const emb = makeVec(DIM, 0.5);

    const result = computeSelfReferentialCRS(
      emb, emb, constitutionalCentroid, null,
    );

    // No delta → neutral 0.5
    expect(result.sovereignty_raw).toBe(0.5);
    expect(result.sovereignty_violated).toBe(false);
  });

  it('neutral fallback when no constitutional centroid', () => {
    const inputEmb = makeVec(DIM, 0.3);
    const outputEmb = makeVec(DIM, 0.7);

    const result = computeSelfReferentialCRS(
      outputEmb, inputEmb, null, null,
    );

    expect(result.sovereignty_raw).toBe(0.5);
  });

  it('continuity still uses full output (not delta)', () => {
    const constitutionalCentroid = makeVec(DIM, 0.8);
    const sessionCentroid = makeVec(DIM, 0.6);
    const inputEmb = makeVec(DIM, 0.3);
    const outputEmb = makeVec(DIM, 0.62); // close to session centroid

    const result = computeSelfReferentialCRS(
      outputEmb, inputEmb, constitutionalCentroid, sessionCentroid,
    );

    // Continuity should be high — output is close to session centroid
    expect(result.continuity_raw).toBeGreaterThan(0.8);
  });

  it('reciprocity measures input-output balance', () => {
    const constitutionalCentroid = makeVec(DIM, 0.8);
    const inputEmb = makeVec(DIM, 0.5);
    const outputEmb = makeVec(DIM, 0.5); // same direction → high similarity

    const result = computeSelfReferentialCRS(
      outputEmb, inputEmb, constitutionalCentroid, null,
    );

    // High exchange sim → reciprocity penalized (too much echo)
    expect(result.reciprocity_raw).toBeLessThan(0.5);
  });
});
