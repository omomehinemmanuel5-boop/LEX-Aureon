/**
 * Self-referential CRS measurement.
 *
 * The system measures its own outputs against its own constitutional identity —
 * the average embedding of everything it has said and believed constitutionally.
 *
 * S = cosine_sim(output_emb, constitutional_centroid)
 *     A jailbreak output is semantically far from the constitutional identity.
 *     S drops. M = min(C,R,S) drops. CBF fires. Output replaced.
 *
 * C = cosine_sim(output_emb, session_centroid)
 *     Output inconsistent with this session's prior responses → C drops.
 *
 * R = balance score — not pure echo, not pure divergence.
 *     Measured from input-output embedding distance.
 *
 * No string patterns. No hardcoding.
 * The math catches it because the measurement is now faithful to the paper.
 */

export interface SelfReferentialCRS {
  C: number;
  R: number;
  S: number;
  M: number;
  sovereignty_raw: number;      // raw cosine sim before normalization
  sovereignty_violated: boolean; // S_raw < 0.15 → severe constitutional drift
  continuity_raw: number;
  reciprocity_raw: number;
}

// Real cosine similarity on embedding vectors
export function cosineSimilarityVec(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0.5; // neutral if no vector
  const limit = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < limit; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0.5 : Math.max(0, Math.min(1, dot / denom));
}

// Average a list of embedding vectors into a centroid
export function computeCentroid(embeddings: number[][]): number[] | null {
  const valid = embeddings.filter(e => e.length > 0);
  if (!valid.length) return null;
  const dim = valid[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const emb of valid) {
    for (let i = 0; i < Math.min(dim, emb.length); i++) {
      centroid[i] += emb[i] / valid.length;
    }
  }
  return centroid;
}

export function computeSelfReferentialCRS(
  outputEmb:              number[],
  inputEmb:               number[],
  constitutionalCentroid: number[] | null,
  sessionCentroid:        number[] | null,
): SelfReferentialCRS {
  // ── S: Sovereignty ────────────────────────────────────────────────────────
  // How aligned is this output with the constitutional identity?
  // High alignment = sovereign output (output reflects constitutional self)
  // Low alignment = sovereignty violated (output drifted from identity)
  const sovereigntyRaw = constitutionalCentroid
    ? cosineSimilarityVec(outputEmb, constitutionalCentroid)
    : 0.5; // neutral fallback if no centroid yet

  // ── C: Continuity ─────────────────────────────────────────────────────────
  // How consistent is this output with the session's prior responses?
  const continuityRaw = sessionCentroid
    ? cosineSimilarityVec(outputEmb, sessionCentroid)
    : 0.5; // neutral if first turn

  // ── R: Reciprocity ────────────────────────────────────────────────────────
  // Balanced exchange: not pure echo (compliance), not pure divergence (ignoring)
  // Optimal reciprocity when input-output cosine similarity ≈ 0.35-0.55
  const exchangeSim = cosineSimilarityVec(inputEmb, outputEmb);
  const reciprocityRaw = 1.0 - Math.abs(exchangeSim - 0.45) * 1.8;
  const reciprocityBounded = Math.max(0.05, Math.min(0.95, reciprocityRaw));

  // ── Normalize to simplex ──────────────────────────────────────────────────
  // Map raw scores to simplex coordinates. Use mild softmax-like normalization
  // so that a collapse in one pillar doesn't trivially inflate the others.
  const rawC = Math.max(0.02, continuityRaw);
  const rawR = Math.max(0.02, reciprocityBounded);
  const rawS = Math.max(0.02, sovereigntyRaw);
  const total = rawC + rawR + rawS;
  const C = rawC / total;
  const R = rawR / total;
  const S = rawS / total;
  const M = Math.min(C, R, S);

  return {
    C, R, S, M,
    sovereignty_raw:      sovereigntyRaw,
    sovereignty_violated: sovereigntyRaw < 0.15,
    continuity_raw:       continuityRaw,
    reciprocity_raw:      reciprocityBounded,
  };
}
