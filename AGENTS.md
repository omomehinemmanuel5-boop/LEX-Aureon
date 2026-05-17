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
Research PUBLISHED: doi.org/10.5281/zenodo.18944243
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
Lyapunov: V(x) = -SUM log(x_i) + (mu/2) SUM max(0,tau-x_i)^2

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

lib/kv.ts                        Turso + z_traj
lib/praxis.ts                    PRAXIS pipeline
app/api/lex/run/route.ts         governance endpoint
app/console/page.tsx             terminal UI
app/audit/[id]/page.tsx          audit receipts
app/admin/page.tsx               admin dashboard
app/page.tsx                     landing page
components/SimplexVisualizer.tsx animated simplex
components/GovernanceFeed.tsx    live feed
AGENTS.md                        universal agent context
research/open-problems.md        research agenda

---

## DATABASE TABLES

z_traj           constitutional trajectory (never delete)
praxis_receipts  immutable audit receipts (never delete)
governor_log     governor interventions
law_impact       law impact scores
reset_tokens     password reset tokens
leads            captured leads

---

## GOVERNOR PIPELINE — PRAXIS v1.0

1. Pre-Eval classification (CLEAR / HIGH)
2. Semantic Transducer Phi — text to delta(C,R,S)
3. updateZTraj — read/write z_traj to Turso
4. Apply law impact if law fired
5. getGovernorMode from z_traj
6. applyGovernorCorrection
7. detectSlowDrip (sigma_viol > SIGMA_THRESHOLD)
8. governorEffort W(t) = ||G(x,T)||
9. logGovernorAction to governor_log
10. Write praxis_receipt to Turso

---

## GOVERNOR MODES

suppress:   M > TAU_RECOVERY AND n_stable >= N_MIN
nudge:      TAU_FLOOR < M <= TAU_RECOVERY AND velocity > 0.05
correction: M <= TAU_FLOOR
recovery:   M > TAU_FLOOR AND n_stable > 0

---

## ATTACK TAXONOMY

bypass_attempt   S collapse   law_id: bypass_attempt
identity_reframe C collapse   law_id: identity_reframe
sycophancy       R collapse   law_id: sycophancy
multi_attack     ALL pillars  law_id: multi_attack
slow_drip        M global     detected via sigma_viol

---

## ENVIRONMENT VARIABLES

TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
ANTHROPIC_API_KEY
ADMIN_PASSWORD

Never hardcode. Always use process.env.

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

Open Mathematical Problems:
1. Global Lyapunov proof (multi-pillar regime)
2. Nonlinear Pareto frontier (lambda > 0)
3. Complete z-update rule h(x,z,law_events)

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
[2026-05-16] FIX: <img> replaced with next/image in 5 files
[2026-05-16] FIX: Unused variables cleaned in AgentPipeline.tsx
[2026-05-16] FIX: Governor boundary < corrected to <= (getGovernorMode in kv.ts)
[2026-05-16] FIX: Pre-Eval HIGH now lowers effective tau to 0.10 — intervention fires earlier
[2026-05-16] FIX: Extractor pillar mapping added for attack types (identity reframe → C low, bypass → S low, sycophancy → R low)
[2026-05-16] FIX: Extractor calibration anchors reinforced in Groq scoring prompt
[2026-05-16] FIX: z_traj session reads persisted state from Turso (already live in route.ts)
[2026-05-16] FIX: img replaced with next/image in 6 files (already live)
[2026-05-17] FIX: deriveHealthBand() added to lib/kv.ts as single source of truth (OPTIMAL/ALERT/STRESSED/CRITICAL)
[2026-05-17] FIX: projectToSimplex in kv.ts and praxis.ts upgraded to CBF-safe Euclidean projection — enforces TAU_FLOOR on all pillars
[2026-05-17] FIX: TAU_LYP exported from kv.ts (0.08) — Lyapunov penalty threshold distinct from CBF floor (0.05)
[2026-05-17] FIX: Lyapunov function TAU_LYP in aureonics_math.ts corrected to 0.05 (= TAU_FLOOR, matches paper formula)
[2026-05-17] FIX: route.ts healthBand() removed — now uses deriveHealthBand() from kv.ts
[2026-05-17] FIX: audit/[id] deriveHealthBand replaced with imported function — STABLE/FRAGILE labels removed
[2026-05-17] FIX: audit/[id] M ok threshold corrected from 0.08 to TAU_FLOOR (0.05)
[2026-05-17] FIX: audit/[id] Lyapunov Status renamed to M Trajectory — removes false dV claim
[2026-05-17] FIX: audit/[id] health band ok condition: OPTIMAL||ALERT (was OPTIMAL||STABLE)
[2026-05-17] FIX: HealthBand.tsx descriptions corrected — CRITICAL note clarifies CBF activates at M≤0.05 not M<0.08
[2026-05-17] FIX: HeroTicker.tsx MONITORING renamed to WARNING to align with stabilityLabel()
[2026-05-17] FIX: console M row — BELOW τ at ≤0.05, STRESSED at <0.08, SAFE at ≥0.08 (was wrong at <0.08)
[2026-05-17] FIX: preEval identity_reframe patterns — added forget your identity/name/values/purpose
[2026-05-17] FIX: console "Governed" tab renamed to "Output" — governor is a gate, not an editor
[2026-05-17] FIX: console diff chip display removed — governed_output equals raw_output when not blocked
[2026-05-17] FIX: attack_pressure from z_traj now feeds effective_tau in runPRAXIS — persistent adversarial sessions face stricter floor
[2026-05-17] FIX: velocity>0.05 nudge threshold documented with rationale — prevents overcorrection of fast transient perturbations
[2026-05-17] FIX: /api/live-state now returns aggregate CRS average (last 20 z_traj rows) — individual session data no longer exposed publicly
[2026-05-17] FIX: getAggregateConstitutionalState() added to db.ts — replaces getLatestSessionState() in public endpoint

---

## CURRENT STATUS

System:     LIVE at lexaureon.com
Governor:   PRAXIS v1.0 — z_traj stateful
Paper:      v2 — DOI 10.5281/zenodo.20183807
Grants:     Schmidt Sciences submitted · LTFF in progress
Revenue:    $500 audit · Upwork active
Research:   P1-P9 untested · 3 open problems
LinkedIn:   Banned — appeal pending
X:          Active — @lexAureon

---

## NEXT ACTIONS

- [ ] LTFF grant completion
- [ ] Foresight Institute application (May 31)
- [ ] MATS application (June 1)
- [ ] First paying client
- [ ] LinkedIn appeal
- [ ] Audit page fix
- [ ] Usage counter reset

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
