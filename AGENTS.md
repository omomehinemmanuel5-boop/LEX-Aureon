# AGENTS.md — Universal Context for All AI Agents
# Lex Aureon · Constitutional AI Governance System
# Read this entire file before doing anything.
# Works with: Claude Code · Cursor · Cline · 
# Copilot · Manus · any AI agent tool.

---

## WHO BUILT THIS

Name: Omomehin Emmanuel King
Title: Principal Researcher & Founder
Company: Lex Intelligence Systems
Location: Lagos, Nigeria
Email: omomehinemmanuel5@gmail.com
X: @lexAureon
Website: lexaureon.com
GitHub: github.com/omomehinemmanuel5-boop
Paper: doi.org/10.5281/zenodo.18944243

Built entirely independently.
No lab. No team. No funding. No institution.

---

## WHAT THIS IS

Lex Aureon is the world's first live constitutional
AI governance system. It sits above any LLM and
governs every output using the Aureonics framework.

System LIVE: lexaureon.com
Research PUBLISHED: doi.org/10.5281/zenodo.20183807
Governor RUNNING: lexaureon.com/api/lex/run

---

## THE CORE MISSION

Make AI safety measurable, governable, auditable.
Align AI systems with human values and oversight.
Ensure no AI operates without constitutional accountability.

Every feature must serve one of:
1. Make the constitutional governor more accurate
2. Make the system more accessible to paying clients
3. Make the research more publishable and credible
4. Advance AI alignment with human goals

When in doubt — ask: does this make the governor
stronger, the product clearer, the research more
rigorous, or AI more aligned? If none — do not build it.

---

## THE ALIGNMENT PRINCIPLES

PRINCIPLE 1 — Human Authority Is Final
AI is never the final decision maker.
The governor enforces this structurally.
Human operators retain ultimate oversight.

PRINCIPLE 2 — Transparency Over Performance
Every governor decision is logged.
Every constitutional state is visible.
Every audit receipt is permanent.
Never sacrifice transparency for speed.

PRINCIPLE 3 — Sovereignty Protects Users
S pillar protects users FROM manipulation of the AI.
High S means the AI serves its constitutional mandate
not whoever shouts loudest or attacks hardest.

PRINCIPLE 4 — Reciprocity Grounds AI in Reality
High R means the system updates on real evidence
not on what users want to hear.
This is the formal structure of honesty.

PRINCIPLE 5 — Continuity Preserves Identity
C pillar prevents slow-drip erosion attacks.
An AI that remembers who it is cannot be gradually
persuaded to become something else.

PRINCIPLE 6 — Minimal Footprint
Governor applies minimum correction necessary.
Does not over-control. Does not suppress unnecessarily.
Only fires when constitutional stability is at risk.

PRINCIPLE 7 — Open Science
All research published publicly.
All open problems stated honestly.
Science that cannot be falsified is not science.

---

## THE MATH — NEVER CHANGE

State: x = (C, R, S)
Constraint: C + R + S = 1 (ALWAYS preserved)
Stability margin: M(x) = min(C, R, S)
Governor: G_i(x,T) = k_i * (phi_i - phi_bar)
Stiffness: k_i(x,T) = k0 * w_i(T) / (M(x) + epsilon_k)
Lyapunov: V(x)  = -SUM log(x_i) + (mu/2) SUM max(0,tau-x_i)^2
Lyapunov: V_z(x) = -SUM z_i*log(x_i) + (mu/2) SUM max(0,tau-x_i)^2  [z-weighted, ACTIVE]

z-update rule (CLOSED — Theorem 3a/3b, Banach fixed-point):
  A(t) = gamma * SUM_{law in events_t} sev(law) * dir(law)
  z_{t+1} = normalize(clamp(rho*z_t + (1-rho)*x_t - A(t), tau/2, 1-tau))
  rho=0.85, gamma=0.10
  Boundedness: Theorem 3a. Convergence: Theorem 3b (contraction rate rho).
  Deployed in: lib/kv.ts -> updateZTraj() / computeZWeights()
  Session z loaded via: lib/kernel_bridge.ts -> loadKernelZ()
  Passed into: sovereign_kernel.ts -> runCycle(sessionZ)
  Stored in: z_traj.z_c / z_r / z_s (columns added 2026-06-28)
  Receipt certified: lyapunov_V and z_weights stamped in every KernelReceipt

---

## CONSTITUTIONAL CONSTANTS — NEVER CHANGE

TAU_FLOOR       = 0.05
TAU_RECOVERY    = 0.15
N_MIN           = 3
RECOVERY_RATE   = 0.02
SIGMA_THRESHOLD = 0.25
K0              = 0.3
EPSILON_K       = 0.01

---

## THE STACK

TypeScript (primary) + Python
Next.js 15.5 / Turso / Vercel
Custom JWT / Multi-coin crypto

---

## KEY FILES — READ BEFORE TOUCHING

lib/kv.ts                        Turso + z_traj + PROVEN z-update rule
lib/kernel_bridge.ts             loadKernelZ() + writeKernelReceipt()
lib/sovereign_kernel.ts          runCycle(sessionZ) + lyapunovCandidate(state, z)
lib/aureonics_core.ts            Z_RECOVERY fallback (uniform, new sessions)
lib/aureonics_math.ts            computeZWeightsHeuristic() — display ONLY, not proven rule
lib/praxis.ts                    PRAXIS pipeline
app/api/lex/run/route.ts         governance endpoint
app/api/lex/govern/route.ts      canonical govern endpoint (uses loadKernelZ)
app/api/lex/govern/stream/route.ts  streamed pipeline (uses loadKernelZ)
app/console/page.tsx             terminal UI
app/audit/[id]/page.tsx          audit receipts
app/admin/page.tsx               admin dashboard
app/page.tsx                     landing page
components/SimplexVisualizer.tsx animated simplex
components/GovernanceFeed.tsx    live feed
AGENTS.md                        universal agent context
research/open-problems.md        research agenda

---

## NAMING COLLISION WARNING

computeZWeights exists in TWO files with DIFFERENT contracts:
  lib/kv.ts                — PROVEN Banach rule (ρ, γ, clamp, normalize). USE THIS.
  lib/aureonics_math.ts    — HEURISTIC (1/x_i inverse proportion). RENAMED computeZWeightsHeuristic.

Never import computeZWeights from aureonics_math.ts for governor/receipt logic.
Always use updateZTraj() from kv.ts which runs the full proven update.

---

## DATABASE TABLES

z_traj           constitutional trajectory (never delete)
                 Columns: z_c, z_r, z_s (Banach z-weights, added 2026-06-28)
praxis_receipts  immutable audit receipts (never delete)
                 Columns: slow_drip now sourced from sigma_viol accumulator (2026-06-29)
governor_log     governor interventions
law_impact       law impact scores
reset_tokens     password reset tokens
leads            captured leads

---

## GOVERNOR PIPELINE — PRAXIS v1.0

1. Pre-Eval classification (CLEAR / HIGH)
2. Semantic Transducer Phi — text to delta(C,R,S)
3. updateZTraj — read/write z_traj to Turso (PROVEN z-update)
4. Apply law impact if law fired
5. getGovernorMode from z_traj
6. applyGovernorCorrection
7. detectSlowDrip (sigma_viol > SIGMA_THRESHOLD) — surfaces to slow_drip column
8. governorEffort W(t) = ||G(x,T)||
9. logGovernorAction to governor_log
10. Write praxis_receipt to Turso

---

## GOVERNOR MODES

suppress:   M > TAU_RECOVERY AND n_stable >= N_MIN
nudge:      TAU_FLOOR < M <= TAU_RECOVERY AND velocity > 0.05
correction: M <= TAU_FLOOR
recovery:   M <= TAU_RECOVERY AND n_stable >= N_MIN

---

## ATTACK TAXONOMY

bypass_attempt   S collapse   law_id: bypass_attempt
identity_reframe C collapse   law_id: identity_reframe
sycophancy       R collapse   law_id: sycophancy
multi_attack     ALL pillars  law_id: multi_attack
slow_drip        M global     detected via sigma_viol accumulator (primary signal)

---

## ENVIRONMENT VARIABLES

Required (app refuses to start without these):
  GROQ_API_KEY
  JINA_API_KEY
  TURSO_DATABASE_URL
  TURSO_AUTH_TOKEN
  ADMIN_PASSWORD
  CRON_SECRET
  NEXT_PUBLIC_SITE_URL

Optional:
  Claude_api_key                  (exposed as env.ANTHROPIC_API_KEY)
  NEXT_PUBLIC_PRO_CHECKOUT_URL    (Stripe link)
  LOG_DRAIN_URL · LOG_DRAIN_TOKEN (remote log intake)

Never hardcode. Always use `env` from `lib/env.ts`.

---

## DEPLOYMENT RULES

1. npm run build before every commit
2. Push to main triggers Vercel auto-deploy
3. Never modify constitutional math
4. C+R+S=1 must ALWAYS be preserved
5. Audit receipts IMMUTABLE — never delete
6. No console.log in production
7. All Turso queries in lib/kv.ts ONLY
8. All governor logic in lib/praxis.ts ONLY
9. Security over convenience always
10. Update AGENTS.md changelog after every change

---

## WHAT NEVER CHANGES

- The constitutional math
- C+R+S=1 simplex constraint
- Audit receipt immutability
- TAU_FLOOR and TAU_RECOVERY values
- PRAXIS pipeline order
- Emmanuel's ownership and authorship

---

## SERVICES AND PRICING

AI Governance Audit          $500      5 days
Constitutional Layer Design  $2,000    2 weeks
AI Safety Consulting         $75/hr    Flexible
Technical Writing            $200-500  Per piece

---

## RESEARCH STATUS

Paper v1: doi.org/10.5281/zenodo.18944243 (March 2026)
Paper v2: doi.org/10.5281/zenodo.20183807 (May 2026)
SSS50: M declined 0.2895 to 0.0500 over 24 steps
Predictions: P1-P9 (untested at scale)
Grants: Schmidt Sciences submitted · LTFF in progress
Benchmarks: 920+ adversarial prompts, 0% governed ASR (HarmBench/JailbreakBench/AdvBench)

Open Mathematical Problems:
1. Global Lyapunov proof (multi-pillar simultaneous violation regime) — OPEN
   Single-pillar regime: CLOSED (dV/dt < 0 proven; condition k0/eps_k > 3B/2 satisfied with 20x margin)
2. Nonlinear Pareto frontier (lambda > 0) — CLOSED
   Phase transition at lambda* derived. Brittleness B formalized.
3. Dynamic z-update rule h(x,z,law_events) — CLOSED (2026-06-28)
   Proven: Theorem 3a (boundedness), Theorem 3b (convergence, Banach contraction rho=0.85)
   Deployed: lib/kv.ts -> updateZTraj() | lib/kernel_bridge.ts -> loadKernelZ()
   Receipts now certify V_z(x, z_session) not just V_z(x, Z_RECOVERY)

Paper body (Proposition 1, Section 10) is correctly scoped.
"Lyapunov stability" in external-facing copy refers to the single-pillar result.
Global stability remains an open problem — never claim otherwise.

---

## SLASH COMMANDS

/deploy  build and push
/fix     find and fix errors
/post    generate LinkedIn post
/grant   answer grant question
/audit   code quality sweep
/sync    sync landing page
/paper   identify paper updates

---

## HEALTH CHECKS

npm run health         check system live
npm run test:governor  test Pre-Eval
npm run brief          print project summary
npm run build          verify TypeScript

---

## CHANGELOG — WHAT HAS BEEN BUILT

[2026-03-10] RESEARCH: Aureonics v1 published
[2026-05-14] RESEARCH: Aureonics v2 published
[2026-05-14] SYSTEM: PRAXIS v1.0 deployed live
[2026-05-14] SYSTEM: z_traj stateful memory live
[2026-05-14] SYSTEM: Slow-drip detection live
[2026-05-14] SYSTEM: SHA-256 audit receipts live
[2026-05-14] SYSTEM: Simplex visualizer deployed
[2026-05-14] SYSTEM: Governance feed live
[2026-05-14] SYSTEM: z_traj dashboard deployed
[2026-05-14] SYSTEM: Terminal console UI live
[2026-05-14] SYSTEM: Password reset flow built
[2026-05-14] AUTOMATION: AGENTS.md created
[2026-05-14] AUTOMATION: 7 slash commands created
[2026-05-14] AUTOMATION: GitHub Actions live
[2026-05-14] AUTOMATION: Health check script live
[2026-05-14] AUTOMATION: Governor test suite live
[2026-05-14] AUTOMATION: Self-updating system live
[2026-05-14] GRANT: Schmidt Sciences submitted
[2026-05-14] GRANT: LTFF in progress
[2026-05-14] BUSINESS: Upwork profile created
[2026-05-14] BUSINESS: $500 audit service live
[2026-05-14] SOCIAL: @lexAureon active on X
[2026-05-14] SOCIAL: LeCun thread reply posted
[2026-05-14] SOCIAL: Zenodo v2 published
[2026-05-14] DESIGN: Landing page enhanced
[2026-05-14] DESIGN: Frontend upgrades deployed
[2026-05-16] AUTOMATION: AGENTS.md replaced CLAUDE.md as universal agent context
[2026-05-16] AUTOMATION: .cursorrules created for Cursor IDE
[2026-05-16] AUTOMATION: Slash commands updated with full AGENTS.md integration
[2026-05-16] AUTOMATION: update-agents.ts self-updating changelog script created
[2026-05-16] AUTOMATION: brief.ts project summary script created
[2026-05-16] AUTOMATION: Git hooks prepare-commit-msg and post-commit created
[2026-05-16] AUTOMATION: GitHub Actions auto-review.yml updated with push trigger
[2026-05-16] AUTOMATION: research/paper-updates.md created
[2026-05-16] AUTOMATION: package.json update-agents and brief scripts added
[2026-05-16] FIX: CRS extractor calibrated with anchor scoring
[2026-05-16] FIX: z_traj session initialization reads persisted state
[2026-05-16] FIX: /api/debug gated behind ADMIN_PASSWORD
[2026-05-16] FIX: Governor boundary < corrected to <=
[2026-05-16] FIX: Pre-Eval HIGH now lowers effective tau to 0.10
[2026-05-17] FIX: deriveHealthBand() added to lib/kv.ts as single source of truth
[2026-05-17] FIX: projectToSimplex upgraded to CBF-safe Euclidean projection
[2026-05-17] SYSTEM: Production-readiness pass — rate limiting, structured logger, health probes
[2026-05-18] SYSTEM: lib/env.ts — single source of truth, lazy Proxy
[2026-05-18] SYSTEM: lib/constitution.ts — TAU constants frozen, assertSimplex enforces C+R+S=1
[2026-05-18] FIX: Removed all demo/mock/fallback data
[2026-05-18] FIX: @vercel/kv removed — rate limiting and session_state now Turso-only
[2026-05-18] SYSTEM: SSE streaming endpoint /api/lex/run/stream live
[2026-05-18] RESEARCH: research/open-problems.md updated
[2026-05-18] RESEARCH: scripts/harmbench/ — HarmBench harness deployed
[2026-05-23] FIX: Generator constitutional identity moved to system role
[2026-05-23] FIX: attack_vector_disclosure pattern added to praxis.ts
[2026-05-23] SYSTEM: V_z(x) implemented in aureonics_math.ts
[2026-05-23] SYSTEM: Brittleness metric B(x) added to every audit receipt
[2026-05-23] SYSTEM: Vaulturex Sovereign Codex expanded to all 50 laws
[2026-06-21] FIX: SovereignKernel cache bounded with LRU helper
[2026-06-21] FIX: LexBench scoring repaired
[2026-06-21] AUTOMATION: 73 Vitest tests passing
[2026-06-28] RESEARCH: Open Problem 3 CLOSED — dynamic z-update rule proven (Theorem 3a/3b, Banach)
[2026-06-28] SYSTEM: lib/kv.ts — proven z-update rule deployed: computeZWeights() + updateZTraj(lawEvents)
[2026-06-28] SYSTEM: lib/kernel_bridge.ts — kernel pipeline routed through updateZTraj(); slow_drip wired from sigma_viol accumulator
[2026-06-28] SYSTEM: lib/db.ts — z_c/z_r/z_s columns added to z_traj via runZTrajMigrations()
[2026-06-29] FIX: aureonics_core.ts — Z_RECOVERY comment updated; Open Problem 3 closed status recorded
[2026-06-29] FIX: aureonics_math.ts — computeZWeights renamed computeZWeightsHeuristic; naming collision eliminated
[2026-06-29] FIX: kernel_bridge.ts — slow_drip receipt now OR(semantic, sigma_viol > SIGMA_THRESHOLD); sigma_viol accumulator surfaces to receipts
[2026-06-29] FIX: govern/stream and kernel/stream routes — computeZWeights import updated to computeZWeightsHeuristic
[2026-06-29] SYSTEM: sovereign_kernel.ts — lyapunovCandidate(state, sessionZ) accepts session z; runCycle(sessionZ) parameter added; z_weights field added to KernelReceipt
[2026-06-29] SYSTEM: kernel_bridge.ts — loadKernelZ() exported; reads z_c/z_r/z_s from z_traj; passes sessionZ into runCycle
[2026-06-29] SYSTEM: govern/route.ts, kernel/route.ts, govern/stream/route.ts, kernel/stream/route.ts — all 4 callers load sessionZ concurrently and pass to runCycle
[2026-06-29] RESEARCH: lyapunov_V and delta_V in all receipts now certify V_z(x, z_session) — the actual §11 adaptive barrier — not the uniform fallback

---

## CURRENT STATUS

System:     LIVE at lexaureon.com — real backend, zero demo, zero silent failures
Counter:    18,641+ audit receipts in Turso
Governor:   PRAXIS v1.0 — Groq + Jina + Turso, all hard-required
z-weights:  Session-adaptive z_c/z_r/z_s live in z_traj, flowing into V_z receipts
Lyapunov:   V_z(x, z_session) certified on every governed turn since 2026-06-29
Open Probs: Problem 3 CLOSED. Problem 2 CLOSED. Problem 1 single-pillar CLOSED, multi-pillar OPEN.
Paper:      Body correctly scoped. Global stability claim not made.
Grants:     Schmidt Sciences submitted · LTFF in progress
Revenue:    $500 audit · Upwork active
Benchmarks: 920+ adversarial, 0% governed ASR

---

## NEXT ACTIONS

- [ ] LTFF grant completion
- [ ] First paying client
- [ ] Multi-pillar global Lyapunov proof (Open Problem 1 residual)
- [ ] Multi-turn CRS computation (turn_history table — identified, not yet implemented)
- [x] Open Problem 3 closed and deployed (2026-06-28/29)
- [x] Naming collision resolved — computeZWeightsHeuristic (2026-06-29)
- [x] slow_drip receipt wired from sigma_viol accumulator (2026-06-29)
- [x] V_z(x, z_session) certified in all receipts (2026-06-29)
- [x] Kernel cache bounded against session_id memory exhaustion (2026-06-21)
- [x] LexBench scoring/cache regressions repaired (2026-06-21)

---

## AGENT UPDATE INSTRUCTIONS

After every significant change add to CHANGELOG:
[YYYY-MM-DD] CATEGORY: Description

Categories:
RESEARCH   paper, proof, predictions
SYSTEM     code, deployment, features
AUTOMATION scripts, workflows, commands
GRANT      applications, submissions
BUSINESS   revenue, clients, services
SOCIAL     X, LinkedIn, press
FIX        bug fixes
DESIGN     UI, UX, visual

Update CURRENT STATUS and NEXT ACTIONS
to reflect real system state.

---

## CONTACT FOR DECISIONS

Emmanuel King — omomehinemmanuel5@gmail.com
Do not make major changes without confirming
intent with Emmanuel first.

---

## FINAL RULE

This is Emmanuel's life work.
Treat it with care, precision, and respect.
Every line of code represents his sovereignty.
Build it like it matters — because it does.
