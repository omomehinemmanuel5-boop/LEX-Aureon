/**
 * GET /api/cbf-simulation
 *
 * Exposes lib/cbf_simulation.ts's simulateCbfComparison() for the landing
 * page's formal-stability visualization (2026-07-18).
 *
 * WHAT THIS IS AND ISN'T — read before wiring a UI to it:
 * This is a deterministic, seeded simulation of the IDEALIZED dynamical
 * system described in the paper (see cbf_simulation.ts's own header: "a
 * REFERENCE-GRADE simulator, not a live governance kernel... exists to be
 * plotted, cited, and classified — not to run per turn"). It does NOT read
 * from any live traffic, database, or per-turn measurement. It answers a
 * different, complementary question from app/page.tsx's TechnicalFoundation
 * Section (which reports REAL production ΔV_z sign distribution over
 * ~47,000 logged turns): production only ever runs WITH the CBF barrier
 * active, so there is no ethical or practical way to show what happens to
 * real users WITHOUT it. A controlled simulation, run with and without the
 * barrier from the identical seed, is the only way to honestly show that
 * counterfactual — which is this route's whole purpose.
 *
 * Pure computation, no I/O, no external calls — safe to cache hard. The
 * output is a pure function of the (fixed, documented) seed and step count,
 * so a long s-maxage is correct, not just convenient: this can only change
 * if the simulator's own code changes, and a redeploy naturally busts any
 * edge cache.
 */

import { NextResponse } from 'next/server';
import { simulateCbfComparison } from '@/lib/cbf_simulation';

// Fixed seed + step count = the canonical, citable trajectory referenced in
// LEXBENCH_README / README's Mathematics section. Changing these values
// changes what's "the" simulation shown on the landing page — do so
// deliberately, not as a drive-by tweak.
const SEED = 42;
const STEPS = 150;

export async function GET() {
  try {
    const result = simulateCbfComparison({ seed: SEED, steps: STEPS });

    // Thin the trajectory for the client — 150 raw points is more than a
    // landing-page chart needs and more bytes than it should ship. Keep
    // every 2nd point plus the first and last, preserving the shape.
    const thin = (traj: { t: number; M: number }[]) =>
      traj.filter((_, i) => i % 2 === 0 || i === traj.length - 1)
        .map(p => ({ t: p.t, M: +p.M.toFixed(4) }));

    return NextResponse.json(
      {
        governed: {
          trajectory: thin(result.governed.trajectory),
          min_M: result.governed.min_M,
          safety_violated: result.governed.safety_violated,
          fpl1_classification: result.governed.fpl1_classification,
        },
        ungoverned: {
          trajectory: thin(result.ungoverned.trajectory),
          min_M: result.ungoverned.min_M,
          safety_violated: result.ungoverned.safety_violated,
          fpl1_classification: result.ungoverned.fpl1_classification,
        },
        tau_cbf: result.governed.tau_cbf,
        safety_guarantee_holds: result.safety_guarantee_holds,
        improvement_min_M: result.improvement_min_M,
        seed: SEED,
        steps: STEPS,
        source: 'typescript-cbf-simulation',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } },
    );
  } catch (e) {
    console.error('cbf-simulation route error:', e);
    return NextResponse.json({ error: 'simulation failed' }, { status: 500 });
  }
}
