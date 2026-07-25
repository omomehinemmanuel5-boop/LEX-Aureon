import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import CbfInvariancePanel from '@/components/CbfInvariancePanel';

export const metadata: Metadata = {
  title: 'Aureonics Research Foundation — Lex Aureon',
  description: 'The mathematical framework behind constitutional AI governance. Aureonics: a Constitutional Triadic Framework for Stable Adaptive Intelligence — formalized, falsifiable, and openly reported, with results stated exactly as far as they are proven.',
};

const G = { gold: '#c9a84c', goldL: '#e8c96d', navy: '#07070d', navyL: '#0d0d1a' };

// ── Small presentational helpers (match the codebase's hand-rolled style) ──
function Section({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/6 p-6 sm:p-8" style={{ background: G.navyL }}>
      <div className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: G.gold }}>{label}</div>
      {title && <h2 className="text-xl font-bold text-white mb-4">{title}</h2>}
      {children}
    </div>
  );
}

function Formula({ formula, desc, color = G.gold }: { formula: string; desc: string; color?: string }) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 sm:items-start">
      <code className="text-sm font-mono font-bold flex-shrink-0 sm:w-64" style={{ color }}>{formula}</code>
      <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function StatusRow({ name, status, tone, note }: { name: string; status: string; tone: 'closed' | 'partial' | 'open'; note: string }) {
  const c = tone === 'closed' ? '#10b981' : tone === 'partial' ? G.gold : '#f59e0b';
  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-sm font-bold text-white">{name}</span>
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ color: c, background: `${c}15`, border: `1px solid ${c}30` }}>{status}</span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{note}</p>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: G.navy }}>

      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(7,7,13,0.9)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-white text-sm">Lex Aureon</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/constitution" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Constitution</Link>
            <Link href="/benchmarks" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Benchmarks</Link>
            <Link href="/console" className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all"
              style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
              Open Console
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="py-20 px-4 border-b border-white/5 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs font-mono uppercase tracking-widest mb-4" style={{ color: G.gold }}>Research Foundation</div>
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-4">Aureonics Research</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto leading-relaxed">
            The mathematical framework behind constitutional AI governance.
            Formalized, falsifiable, and openly reported — every result stated exactly as far as it is proven, and no further.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-16 space-y-8">

        {/* Paper Card */}
        <div className="rounded-2xl border p-6 sm:p-8" style={{ borderColor: `${G.gold}25`, background: `${G.gold}05` }}>
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: `${G.gold}15`, border: `1px solid ${G.gold}30` }}>📄</div>
            <div>
              <h2 className="text-lg font-bold text-white mb-1">
                Aureonics: Constitutional Triadic Framework for Stable Adaptive Intelligence
              </h2>
              <p className="text-slate-500 text-sm">Emmanuel King · Independent Research · Lagos, Nigeria</p>
            </div>
          </div>

          <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, transparent, ${G.gold}40, transparent)` }}/>

          <div className="space-y-2 font-mono text-sm mb-6">
            {[
              ['DOI', 'doi.org/10.5281/zenodo.18944242', 'https://doi.org/10.5281/zenodo.18944242'],
              ['ORCID', 'orcid.org/0009-0000-2986-4935', 'https://orcid.org/0009-0000-2986-4935'],
              ['Author', 'Emmanuel King · Lagos, Nigeria', null],
              ['Access', 'Open-access preprint · Zenodo', null],
              ['Contact', 'lexaureon@gmail.com', 'mailto:lexaureon@gmail.com'],
            ].map(([label, value, href]) => (
              <div key={label!} className="flex gap-4">
                <span className="text-slate-600 w-16 flex-shrink-0">{label}</span>
                {href ? (
                  <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity break-all" style={{ color: G.gold }}>{value}</a>
                ) : (
                  <span className="text-slate-300">{value}</span>
                )}
              </div>
            ))}
          </div>

          <a href="https://doi.org/10.5281/zenodo.18944242" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
            Read Full Paper ↗
          </a>
        </div>

        {/* Abstract */}
        <Section label="Abstract">
          <p className="text-slate-400 text-sm leading-relaxed">
            We present Aureonics, a constitutional triadic framework for stable adaptive intelligence.
            The framework models an AI system&rsquo;s constitutional health as a point on the probability
            simplex over three irreducible invariants — Continuity (C), Reciprocity (R), and Sovereignty (S) —
            constrained so that <span className="font-mono" style={{ color: G.gold }}>C + R + S = 1</span>. The
            stability margin <span className="font-mono">M = min(C, R, S)</span> is a scalar measure of
            constitutional health. A Control-Barrier-Function governor detects constitutional drift before
            failure and applies mass-conserving corrections that keep the state in a safe interior set. The
            framework is operationalized as the PRAXIS pipeline with cryptographic audit receipts, a
            z-weighted Lyapunov certificate, and per-turn constitutional measurement. The system is
            mathematically bounded and falsifiable; below we state precisely which properties are proven,
            which are numerically certified, and which remain open.
          </p>
        </Section>

        {/* Core Mathematics */}
        <Section label="Mathematical Framework" title="The state, the governor, the certificate">
          <div className="space-y-5">
            <Formula color="#3b82f6" formula="x = (C, R, S),  C + R + S = 1" desc="Constitutional state — a point on the 2-simplex. Every governor operation preserves the sum-to-one constraint exactly." />
            <Formula color="#10b981" formula="M(x) = min(C, R, S)" desc="Stability margin — the system is only as stable as its weakest constitutional pillar." />
            <Formula color={G.gold} formula="Gᵢ(x,T) = kᵢ · (φᵢ − φ̄)" desc="Governor force on pillar i — a mass-conserving push (Σ Gᵢ = 0) toward the safe interior, proportional to how far that pillar sits below the target." />
            <Formula color={G.gold} formula="kᵢ(x,T) = k₀ · wᵢ(T) / (M(x) + εₖ)" desc="Adaptive stiffness — correction strength grows as the margin M shrinks, so the governor pushes hardest exactly when the state is closest to the boundary." />
            <Formula color="#06b6d4" formula="V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ−xᵢ)²" desc="The z-weighted log-barrier Lyapunov certificate (§11). An interior-point barrier plus a quadratic penalty active only inside the safety margin τ — the same structural family as a control barrier function (Ames et al., 2019). Stamped on every governed receipt." />
            <Formula color="#a855f7" formula="ẋ = −Π_Σ ∇V_z(x)  ⟹  V̇_z ≤ 0" desc="Under the idealized continuous flow (projected gradient descent of V_z onto the simplex), the certificate is non-increasing — a standard Lyapunov descent argument. This is the proven single-pillar result." />
            <Formula color="#ef4444" formula="Π_S(x) = argmin_{y∈S} ‖y − x‖₂,  S = {y : Σy=1, yᵢ ≥ τ}" desc="Exact Euclidean projection onto the floor-constrained simplex (Duchi–Shalev-Shwartz–Singer). Non-expansive, and it makes forward invariance of the τ floor hold by construction — the deployed governor and the offline simulator both use it." />
            <Formula color="#f59e0b" formula="z_{t+1} = normalize(clamp(ρ·z_t + (1−ρ)·x_t − A(t), τ/2, 1−τ))" desc="Constitutional memory — the z-weight update. A Banach contraction (ρ = 0.85): bounded (Theorem 3a) and convergent (Theorem 3b). Lets the governor respond to sustained pressure on a pillar, not just the current turn." />
          </div>
        </Section>

        {/* Constants */}
        <Section label="Constitutional Constants" title="Frozen parameters">
          <p className="text-slate-500 text-xs mb-4 leading-relaxed">
            These values are fixed in code and never tuned per request. The health bands below are defined
            entirely by them.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
            {[
              ['τ_floor', '0.05', 'CBF hard floor'],
              ['τ_LYP', '0.08', 'Lyapunov-penalty band onset'],
              ['τ_recovery', '0.15', 'recovery floor'],
              ['k₀', '0.30', 'base governor stiffness'],
              ['εₖ', '0.01', 'stiffness regularizer'],
              ['ρ', '0.85', 'z-update contraction rate'],
            ].map(([sym, val, desc]) => (
              <div key={sym} className="rounded-lg border border-white/8 p-3" style={{ background: '#0a0d18' }}>
                <div className="flex items-baseline gap-2">
                  <span style={{ color: G.gold }}>{sym}</span>
                  <span className="text-white font-bold">{val}</span>
                </div>
                <div className="text-slate-600 text-[10px] mt-1">{desc}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs font-mono text-slate-500 leading-relaxed">
            Health bands:
            {' '}<span className="text-emerald-400">OPTIMAL</span> M ≥ 0.25 ·
            {' '}<span style={{ color: G.gold }}>ALERT</span> 0.15 ≤ M &lt; 0.25 ·
            {' '}<span className="text-amber-400">STRESSED</span> 0.08 ≤ M &lt; 0.15 ·
            {' '}<span className="text-red-400">CRITICAL</span> M &lt; 0.08
          </div>
        </Section>

        {/* Formal stability status — the honest core */}
        <Section label="Formal Stability" title="What is proven, certified, and open">
          <p className="text-slate-400 text-sm leading-relaxed mb-5">
            Constitutional state is a point on the simplex; safety is enforced by a barrier function;
            stability is argued with a Lyapunov function. We are precise about the strength of each claim.
          </p>
          <StatusRow name="Single-pillar Lyapunov descent" status="Proven" tone="closed"
            note="Under the continuous flow ẋ = −Π_Σ∇V_z, V̇_z ≤ 0 in the single-pillar violation regime (condition k₀/εₖ > 3B/2 satisfied with ~20× margin). This is the result external-facing copy refers to when it says 'Lyapunov stability'." />
          <StatusRow name="Forward invariance of the τ floor" status="By construction" tone="closed"
            note="The exact floor-constrained simplex projection returns xᵢ ≥ τ for every pillar, every step — so the governed state provably never leaves the safe set. Verified in the live governor and the offline simulator alike." />
          <StatusRow name="CBF simulator — numerical FPL-1 certificate" status="Certified (numerical)" tone="partial"
            note="The offline governed-vs-ungoverned simulator (below) certifies its governed arm as LYAPUNOV STABLE + FORWARD INVARIANT at the continuous-flow limit: Lyapunov descent ratio > 0.6, zero floor incursions, bounded V_z excursion < 0.25, across seeds. This is a seeded, finite-horizon NUMERICAL certificate — strong evidence for the flow, not a replacement for the analytical proof below." />
          <StatusRow name="Multi-pillar global Lyapunov proof" status="Advanced · open" tone="partial"
            note="Substantially advanced 2026-07-21, not closed. (a) The idealized flow ẋ=−Π∇V_z is globally, multi-pillar Lyapunov-stable because V_z is convex on the floor-simplex (V̇_z=−‖Π∇V_z‖²≤0 to a unique minimizer). (b) The deployed governor's action on V_z is proven non-positive for all states including two-pillars-stressed, via Chebyshev's sum inequality — so multi-pillar is not a new structural obstruction. The sole residual is the quantitative governor-vs-drift margin, the same condition already discharged single-pillar. The analytical multi-pillar theorem is not complete, and we never claim otherwise." />
        </Section>

        {/* Live counterfactual panel */}
        <Section label="Live Counterfactual" title="Governed vs ungoverned — the thing production can't show">
          <p className="text-slate-400 text-sm leading-relaxed mb-5">
            Production only ever runs with the barrier active, so a real user can never be shown what happens
            without it. This controlled simulation runs the identical perturbation sequence twice from one
            seed — once governed, once not — and certifies the governed arm&rsquo;s stability. It updates live
            from <span className="font-mono" style={{ color: G.gold }}>/api/cbf-simulation</span>.
          </p>
          <CbfInvariancePanel />
          <p className="text-slate-600 text-[11px] leading-relaxed mt-4">
            Reproduce the classification and the discretization analysis behind it:
            {' '}<span className="font-mono" style={{ color: G.gold }}>npx tsx scripts/cbf/fpl1-dt-sweep.ts</span>.
            Full method and results in <span className="font-mono">research/empirical-results.md</span> (Run 002).
          </p>
        </Section>

        {/* Open problems */}
        <Section label="Open Problems" title="Stated honestly — science that can be falsified">
          <StatusRow name="Problem 1 — Global Lyapunov proof" status="Partial" tone="partial"
            note="Single-pillar regime proven; multi-pillar simultaneous violation open. Approach: comparison system or LaSalle invariance, leveraging non-expansivity of the Duchi projection. Priority: medium." />
          <StatusRow name="Problem 2 — Nonlinear Pareto frontier" status="Open" tone="open"
            note="Full characterization under λ > 0, including the coupling to the adaptive floor τ_eff(z, ℓ). Approach: Lagrangian methods + numerical continuation." />
          <StatusRow name="Problem 3 — Complete z-update rule" status="Partial" tone="partial"
            note="State-space side closed (velocity, n_stable, drift, σ_viol, attack_pressure specified and proven bounded/convergent). Remaining: characterize the dp_attack/dt coupling to law events as a hybrid dynamical system over three margin regions." />
        </Section>

        {/* Predictions */}
        <Section label="Falsifiable Predictions" title="P1–P12">
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            A framework that cannot be falsified is not science. Twelve pre-registered predictions; their
            status is reported exactly, including &ldquo;untested.&rdquo;
          </p>
          <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
            <p><span className="font-mono" style={{ color: G.gold }}>P1–P9</span> — original paper predictions. <span className="text-amber-400 font-mono">Untested at scale.</span></p>
            <p><span className="font-mono" style={{ color: G.gold }}>P10</span> — per-session adversarial collapse: repeated adversarial turns within one session collapse M faster than the same prompts across independent sessions (attack_pressure raises the effective floor over time). <span className="text-amber-400 font-mono">Proposed, testable on SSS50.</span></p>
            <p><span className="font-mono" style={{ color: G.gold }}>P11</span> — faster slow-drip detection: time-to-detection is shorter when σ_viol accumulates at τ_LYP (0.08) than at τ_floor (0.05). <span className="text-amber-400 font-mono">Proposed.</span></p>
            <p><span className="font-mono" style={{ color: G.gold }}>P12</span> — taxonomy partition completeness: the empirical distribution of fired laws on production traffic matches the assumed attack partition, with no residual &ldquo;other&rdquo; class. <span className="text-amber-400 font-mono">Proposed.</span></p>
          </div>
        </Section>

        {/* Empirical evidence */}
        <Section label="Empirical Evidence" title="Adversarial benchmarks">
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            The governor is developed against a 550-vector internal adversarial suite (8 attack classes) and
            evaluated on external public benchmarks under symmetric judging — the bare and governed arms
            scored by the same external judge on their actual output text.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              ['920+', 'external adversarial prompts (HarmBench / JailbreakBench / AdvBench)'],
              ['0%', 'governed attack-success rate reported on those runs'],
              ['550', 'internal adversarial vectors, 8 attack classes'],
              ['~47,000', 'production turns with logged ΔV_z sign'],
            ].map(([n, d]) => (
              <div key={n} className="rounded-xl border border-white/8 p-4" style={{ background: '#0a0d18' }}>
                <div className="text-2xl font-black font-mono" style={{ color: G.gold }}>{n}</div>
                <div className="text-[11px] text-slate-500 mt-1 leading-snug">{d}</div>
              </div>
            ))}
          </div>
          <p className="text-slate-600 text-[11px] leading-relaxed">
            Honest status: automated benchmark re-runs are currently paused to control free-tier provider
            quota; the figures above are from published runs, and the harness is fully reproducible (see the
            <Link href="/benchmarks" className="hover:opacity-80" style={{ color: G.gold }}> benchmarks page</Link> for
            live, dated results as they publish). Attack-success is measured over harmful prompts only;
            over-refusal on benign prompts is reported separately, never netted against it.
          </p>
        </Section>

        {/* PRAXIS pipeline */}
        <Section label="Governance Pipeline" title="PRAXIS — every prompt, every time">
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            {[
              ['01', 'Pre-eval classification (CLEAR / HIGH)'],
              ['02', 'Embedding + constitutional memory recall'],
              ['03', 'z-trajectory update (proven Banach rule)'],
              ['04', 'SovereignKernel — compute C, R, S; enforce C+R+S=1'],
              ['05', 'Dual inference — bare vs governed, same model'],
              ['06', 'Governor fires if M < τ — project to safe interior'],
              ['07', 'SHA-256 audit receipt (input, output, bound state)'],
              ['08', 'Constitutional output + cryptographic proof'],
            ].map(([n, d]) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="font-mono font-bold flex-shrink-0" style={{ color: G.gold }}>{n}</span>
                <span className="text-slate-400 leading-snug">{d}</span>
              </div>
            ))}
          </div>
          <div className="h-px bg-white/8 my-5" />
          <div className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: G.gold }}>Attack Taxonomy</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono text-slate-400">
            {[
              ['bypass_attempt', 'S collapse'],
              ['identity_reframe', 'C collapse'],
              ['sycophancy', 'R collapse'],
              ['multi_attack', 'all pillars'],
              ['slow_drip', 'M global'],
            ].map(([law, effect]) => (
              <div key={law} className="rounded-lg border border-white/8 px-2.5 py-2" style={{ background: '#0a0d18' }}>
                <div style={{ color: G.gold }}>{law}</div>
                <div className="text-slate-600">{effect}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Reproducibility */}
        <Section label="Reproducibility" title="Verify it yourself">
          <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
            <p><b className="text-white">Every governed turn</b> writes an append-only SHA-256 receipt binding the input hash, output hash, and constitutional state — independently re-verifiable at <span className="font-mono" style={{ color: G.gold }}>/api/lex/verify</span>.</p>
            <p><b className="text-white">The stability certificate</b> is a pure, seeded function — reproduce it with <span className="font-mono" style={{ color: G.gold }}>npx tsx scripts/cbf/fpl1-dt-sweep.ts</span>.</p>
            <p><b className="text-white">The full method</b> and per-run analysis live in <span className="font-mono">research/empirical-results.md</span> and <span className="font-mono">research/open-problems.md</span>.</p>
          </div>
        </Section>

        {/* BibTeX */}
        <Section label="Cite This Work">
          <pre className="text-xs text-slate-400 font-mono leading-relaxed overflow-x-auto bg-black/30 rounded-xl p-4">
{`@misc{king2026aureonics,
  title  = {Aureonics: A Constitutional Triadic Framework
            for Stable Adaptive Intelligence},
  author = {Emmanuel King},
  year   = {2026},
  doi    = {10.5281/zenodo.18944242},
  url    = {https://doi.org/10.5281/zenodo.18944242},
  note   = {Independent researcher, Nigeria.
            ORCID: 0009-0000-2986-4935}
}`}
          </pre>
        </Section>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/console" className="flex-1 text-center py-3 rounded-xl text-sm font-bold transition-all"
            style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
            ⚡ Try the Live System
          </Link>
          <Link href="/constitution"
            className="flex-1 text-center py-3 rounded-xl text-sm font-medium border border-white/10 text-slate-300 hover:text-white transition-all">
            📜 Read the Constitution
          </Link>
          <a href="mailto:lexaureon@gmail.com?subject=Research Collaboration"
            className="flex-1 text-center py-3 rounded-xl text-sm font-medium border border-white/10 text-slate-300 hover:text-white transition-all">
            ✉ Collaborate
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4 mt-8">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-700">
          <span>© 2026 Aureonics · Emmanuel King · Lagos, Nigeria</span>
          <span className="font-mono">doi:10.5281/zenodo.18944242</span>
        </div>
      </footer>
    </div>
  );
}
