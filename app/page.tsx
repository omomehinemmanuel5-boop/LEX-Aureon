import Link from 'next/link';
import Image from 'next/image';
import PricingSection from '@/components/PricingSection';
import ErrorBoundary from '@/components/ErrorBoundary';
import SimplexVisualizer from '@/components/SimplexVisualizer';
import HeroTicker from '@/components/HeroTicker';
import LandingNav from '@/components/LandingNav';
import LandingEmailCapture from '@/components/LandingEmailCapture';
import EnterpriseSection from '@/components/EnterpriseSection';
import LiveStatsBar from '@/components/LiveStatsBar';
import BenchmarkResults, { type ApiShape as BenchmarkApiShape } from '@/components/BenchmarkResults';
import type { Metadata } from 'next';
import { headers } from 'next/headers';

// Force dynamic rendering — this page calls headers() to resolve
// the host for internal API fetches, so static generation is not possible.
export const dynamic = 'force-dynamic';

// Canonical host is https://www.lexaureon.com (the apex 307-redirects to www).
// metadataBase + alternates.canonical make every generated URL and the canonical
// tag point at the www host, so crawlers see one consistent canonical origin.
//
// fix (2026-07-10) — SEO PASS: <title> previously read "Lex Aureon — Govern
// AI. Ensure Trust. Defend Truth." while openGraph.title (only ever seen on
// social-media link previews, NOT what Google indexes) had the actually
// keyword-bearing phrase "Constitutional AI Governance for LLMs and Agents".
// Google indexes <title> directly for the SERP result — the weaker, more
// abstract phrase was what search saw; the stronger, more searchable phrase
// was hidden behind a Twitter/Slack preview card almost nobody sees via
// organic search. Aligned <title> to the stronger phrase; kept the original
// tagline as a trailing descriptor rather than dropping it entirely.
export const metadata: Metadata = {
  metadataBase: new URL('https://www.lexaureon.com'),
  title: 'Lex Aureon — Constitutional AI Governance for LLMs and Agents',
  description: 'A constitutional control layer for language models. Numerical Lyapunov/CBF certificate, honest open-proof boundary, and cryptographic SHA-256 audit receipts.',
  alternates: {
    canonical: 'https://www.lexaureon.com',
  },
  openGraph: {
    title: 'Lex Aureon — Constitutional AI Governance for LLMs and Agents',
    description: 'A constitutional governance layer for language models and agentic systems: simplex state, numerical CBF/Lyapunov certificate, explicit open-proof boundary, and cryptographic audit receipts.',
    images: [{ url: '/logo.png', width: 1080, height: 1080 }],
    url: 'https://www.lexaureon.com',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lex Aureon — Constitutional AI Governance for LLMs and Agents',
    description: 'Drop-in constitutional governance layer for any LLM or agent. Numerical CBF/Lyapunov certificate + cryptographic audit + honest open-proof boundary.',
    images: ['/logo.png'],
  },
};

// fix (2026-07-10) — SEO PASS: no structured data (JSON-LD) existed anywhere
// on the site before this. For a solo, unfunded, no-lab research project,
// this is one of the highest-leverage available levers: it's the primary
// signal Google's Knowledge Graph and entity-understanding systems use to
// resolve "who/what is this" rather than inferring it from prose alone, and
// it's what enables rich results (sitelinks, knowledge panels) at all.
// Uses an @graph so Organization / Person / SoftwareApplication / WebSite
// resolve as one connected set of entities rather than four disconnected
// blobs. Every fact here is already public elsewhere on the site or in the
// linked paper — no invented ratings, review counts, or unverifiable claims,
// which would risk a manual structured-data action from Google if it looked
// spammy or unsupported.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://www.lexaureon.com/#organization',
      name: 'Aureonics Systems',
      url: 'https://www.lexaureon.com',
      logo: 'https://www.lexaureon.com/logo.png',
      founder: {
        '@type': 'Person',
        name: 'Emmanuel King',
        sameAs: [
          'https://orcid.org/0009-0000-2986-4935',
          'https://x.com/lexAureon',
        ],
      },
      sameAs: [
        'https://x.com/lexAureon',
        'https://github.com/omomehinemmanuel5-boop/LEX-Aureon',
        'https://doi.org/10.5281/zenodo.18944242',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://www.lexaureon.com/#website',
      url: 'https://www.lexaureon.com',
      name: 'Lex Aureon',
      description: 'A constitutional control layer for language models. CBF math, numerical Lyapunov certificate, explicit open-proof boundary, and cryptographic SHA-256 audit receipts.',
      publisher: { '@id': 'https://www.lexaureon.com/#organization' },
      inLanguage: 'en',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://www.lexaureon.com/#software',
      name: 'Lex Aureon',
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Any (API/HTTP)',
      url: 'https://www.lexaureon.com',
      description: 'Constitutional AI governance layer for LLMs and agentic systems. Simplex constitutional state (C+R+S=1), control-barrier-function safety projection, numerical Lyapunov/CBF certificate, explicit open-proof boundary, and cryptographic SHA-256 audit receipts. Drop-in — no retraining or fine-tuning of the underlying model required.',
      publisher: { '@id': 'https://www.lexaureon.com/#organization' },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free live demo console and public API access.',
      },
      sameAs: ['https://doi.org/10.5281/zenodo.18944242'],
    },
    {
      '@type': 'ScholarlyArticle',
      '@id': 'https://doi.org/10.5281/zenodo.18944242',
      name: 'Aureonics: Constitutional Triadic Framework for Stable Adaptive Intelligence',
      author: {
        '@type': 'Person',
        name: 'Emmanuel King',
        sameAs: 'https://orcid.org/0009-0000-2986-4935',
      },
      url: 'https://doi.org/10.5281/zenodo.18944242',
      isPartOf: { '@id': 'https://www.lexaureon.com/#software' },
    },
  ],
};

const G = {
  gold:  '#c9a84c',
  goldL: '#e8c96d',
  goldD: '#a07830',
  C: '#3b82f6',
  R: '#10b981',
  S: '#f59e0b',
};

async function fetchData<T>(path: string): Promise<T | null> {
  try {
    const h = await headers();
    const host = h.get('host');
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const res = await fetch(`${protocol}://${host}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch (e) {
    console.error(`Failed to fetch ${path}:`, e);
    return null;
  }
}

/* ── Hero ─────────────────────────────────────────────────────── */
/* Background is always #07070d, so ALL hero text/borders are always-light —
   never text-slate-900 dark:… hybrids, which render dark-on-dark (barely
   readable) in the light/white theme.
   Vibrancy pass (2026-07-06): swapped the static gold headline gradient for
   the existing .shimmer-gold animated class (already defined in globals.css,
   previously unused anywhere) — a moving highlight instead of a flat gradient,
   at zero new CSS cost. Added a second, offset radial glow blending the C/R/S
   pillar colors behind the gold one, so the background reads as alive rather
   than a single static orb. Bumped badge/pill background+border opacity
   slightly for more visible color presence without changing layout.
   fix (2026-07-11): the word "mathematical" appeared zero times anywhere in
   the visible page copy — checked directly against the live HTML — despite
   <title>/meta already claiming "Constitutional AI Governance" and the page
   citing real mathematical mechanisms (CBF, Lyapunov, simplex state)
   throughout. The word that actually distinguishes this from prompt-
   engineering-with-safety-language competitors was implied but never named.
   Added to the hero subhead, the first substantive sentence a visitor reads —
   closes the gap between what the title tag promises and what the page says. */
async function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-5 pt-20 pb-16 overflow-hidden" style={{ backgroundColor: '#07070d' }}>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(${G.gold} 1px, transparent 1px), linear-gradient(90deg, ${G.gold} 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }} />
        <div className="particle particle-1 w-2 h-2 opacity-30" style={{ background: G.gold, top: '15%', left: '10%', filter: 'blur(1px)' }} />
        <div className="particle particle-2 w-3 h-3 opacity-20" style={{ background: G.goldL, top: '30%', left: '80%', filter: 'blur(2px)' }} />
        <div className="particle particle-3 w-1.5 h-1.5 opacity-25" style={{ background: G.gold, top: '60%', left: '20%' }} />
        <div className="particle particle-4 w-2.5 h-2.5 opacity-15" style={{ background: G.goldL, top: '75%', left: '70%', filter: 'blur(1px)' }} />
        <div className="particle particle-1 w-1 h-1 opacity-35" style={{ background: G.gold, top: '45%', left: '92%', animationDelay: '3s' }} />
        <div className="particle particle-2 w-2 h-2 opacity-20" style={{ background: G.goldD, top: '85%', left: '40%', animationDelay: '6s', filter: 'blur(1px)' }} />
        {/* Primary gold glow — kept, unchanged position/size */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full opacity-[0.07]"
          style={{ background: `radial-gradient(circle, ${G.gold} 0%, transparent 70%)` }} />
        {/* New: second, offset glow blending the C/R/S pillar colors — adds
            color variety to the background without competing with the gold
            headline or hurting text contrast (still very low opacity). */}
        <div className="absolute top-[35%] left-[30%] -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full opacity-[0.05]"
          style={{ background: `radial-gradient(circle, ${G.C} 0%, transparent 65%)` }} />
        <div className="absolute top-[60%] left-[68%] -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-[0.05]"
          style={{ background: `radial-gradient(circle, ${G.R} 0%, transparent 65%)` }} />
        <svg className="absolute inset-0 w-full h-full opacity-[0.02]" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
          <polygon points="400,50 100,520 700,520" fill="none" stroke={G.gold} strokeWidth="1" />
          <polygon points="400,150 200,470 600,470" fill="none" stroke={G.gold} strokeWidth="0.5" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-4xl mx-auto text-center">

        <div className="mb-6"><HeroTicker /></div>

        <div
          className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 max-w-[90vw] px-4 py-1.5 rounded-2xl sm:rounded-full border mb-8 text-[11px] sm:text-xs font-mono"
          style={{ borderColor: `${G.gold}55`, background: `${G.gold}0f`, color: G.gold }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: G.gold }} />
          <span>SovereignKernel v2 · Unified Agent Pipeline · Log-Barrier Dynamics · Cryptographic Audit Receipts</span>
        </div>

        <h1 className="text-4xl sm:text-7xl font-black leading-tight sm:leading-none tracking-tight text-white mb-6">
          AI systems lie, manipulate,<br className="hidden sm:block" /> and drift.{' '}
          <span className="shimmer-gold">
            Lex Aureon governs it.
          </span>
        </h1>

        <p className="text-xs font-mono mb-5 tracking-widest" style={{ color: G.gold, opacity: 0.85 }}>
          Built from Lagos · No lab · No VC · No team
        </p>

        <p className="text-slate-300 text-base sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          A mathematical constitutional control layer for language models and agentic pipelines.
          Numerically certified CBF simulator, append-only audit receipts, and explicit open-proof boundaries.
          Not guardrails, not filters. Drop-in API. Any LLM. Any agent framework.
        </p>

        <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 max-w-[90vw] px-5 py-2.5 rounded-2xl sm:rounded-full border mb-2 font-mono text-xs sm:text-sm border-white/15 bg-white/[0.07]">
          <span className="inline-flex items-center gap-2 sm:gap-3 shrink-0">
            <span style={{ color: G.C }} className="font-bold">C</span>
            <span className="text-slate-500">+</span>
            <span style={{ color: G.R }} className="font-bold">R</span>
            <span className="text-slate-500">+</span>
            <span style={{ color: G.S }} className="font-bold">S</span>
            <span className="text-slate-500">=</span>
            <span className="text-white font-bold">1</span>
          </span>
          <span className="text-slate-600 hidden sm:inline">·</span>
          <span className="text-slate-300 whitespace-nowrap">M = min(C,R,S) &lt; τ → Governor fires</span>
        </div>
        <p className="text-[11px] font-mono text-slate-400 mb-10">
          Continuity · Reciprocity · Sovereignty — three constitutional pillars
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
          <Link
            href="/console"
            className="w-full sm:w-auto px-8 sm:px-10 py-3.5 sm:py-4 rounded-xl text-sm font-black transition-all active:scale-95 cta-pulse flex items-center justify-center gap-2"
            style={{
              background: `linear-gradient(135deg, ${G.gold}, ${G.goldL}, ${G.gold})`,
              backgroundSize: '200% auto',
              color: '#07070d',
              boxShadow: `0 8px 32px ${G.gold}40`,
            }}
          >
            ⚡ Try Lex Console — Free
          </Link>
          <a
            href="https://doi.org/10.5281/zenodo.18944242"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-8 sm:px-10 py-3.5 sm:py-4 rounded-xl text-sm font-bold text-slate-300 hover:text-white border border-white/10 hover:bg-white/5 transition-all text-center"
          >
            📄 Read the Paper ↗
          </a>
        </div>

        <Link
          href="/observatory"
          className="inline-flex min-h-11 max-w-[92vw] items-center justify-center gap-2 rounded-full border border-indigo-300/30 bg-indigo-300/10 px-4 py-2.5 text-center text-xs font-bold text-indigo-200 transition hover:border-indigo-200/60 hover:bg-indigo-300/15 sm:text-sm"
        >
          Explore the Governance Observatory <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="relative z-10 flex justify-center items-center w-full mt-6 opacity-80">
        <ErrorBoundary label="Simplex"><SimplexVisualizer /></ErrorBoundary>
      </div>
    </section>
  );
}

/* ── Six Capabilities ──────────────────────────────────────────── */
function ComparisonSection() {
  const caps = [
    { n: 'Continuous state vector',  d: 'Tracks (C, R, S) as a live constitutional state across the whole exchange — not a single pass/fail flag on one message.' },
    { n: 'Embedding-based measurement', d: 'Constitutional state is measured from embeddings — cosine similarity of the output to a constitutional anchor — not keyword matching. Provider-agnostic (currently Gemini gemini-embedding-001), the same embedding-based method described in the paper.' },
    { n: 'Log-Barrier Dynamics',     d: 'Uses an interior-point log-barrier correction to push the state away from constitutional boundaries, designed for smooth and stable behaviour.' },
    { n: 'Cryptographic receipts',   d: 'Every governed turn writes a SHA-256 receipt — the input hash, the output hash, and a bound hash over the constitutional state — persisted append-only on the same row, so any decision can be independently re-verified after the fact.' },
    { n: 'Constitutional memory',    d: 'z-trajectory memory tracks which pillars are under sustained pressure across turns, so the governor responds to persistent pressure rather than only the current message.' },
    { n: 'No retraining required',   d: 'Runs as a layer above any LLM — GPT, Claude, Gemini, Llama, Mistral — with no fine-tuning and no model changes.' },
  ];
  return (
    <section className="py-20 sm:py-24 px-4 sm:px-5 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 text-slate-600 dark:text-slate-500 font-bold">
            What Lex Aureon combines
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white mb-4">
            Six capabilities,{' '}
            <span className="text-slate-600 dark:text-slate-500 font-light">one governance layer.</span>
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {caps.map(({ n, d }) => (
            <div
              key={n}
              className="rounded-2xl border p-5 bg-white dark:bg-[#c9a84c06] border-slate-200 dark:border-[#c9a84c20] shadow-sm dark:shadow-none card-hover"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-black text-sm">✓</span>
                <span className="text-sm font-mono font-black" style={{ color: G.gold }}>{n}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-xs font-mono text-slate-600 dark:text-slate-600 mt-6">
          Combined in one layer — above any LLM, with no retraining or fine-tuning.
        </p>
      </div>
    </section>
  );
}


/* ── Research handoff ──────────────────────────────────────────── */
function ResearchHandoffSection() {
  return (
    <section className="py-14 px-4 sm:px-5" style={{ backgroundColor: '#07070d' }}>
      <div className="max-w-3xl mx-auto rounded-2xl border border-[#c9a84c30] bg-[#c9a84c08] p-6 sm:p-8 text-center">
        <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
          Research and evidence
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">
          The product is concise. The evidence is not.
        </h2>
        <p className="text-sm text-slate-400 max-w-2xl mx-auto leading-relaxed mb-6">
          The research page is the canonical home for the mathematical framework, proof boundaries,
          numerical certificates, open problems, and reproducibility notes. Benchmarks and live audit
          records have their own pages so each result can be read in context.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/research" className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all" style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
            Read the research
          </Link>
          <Link href="/benchmarks" className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-300 border border-white/10 hover:bg-white/5 transition-all">
            View benchmarks
          </Link>
          <Link href="/audit" className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-300 border border-white/10 hover:bg-white/5 transition-all">
            Inspect audit receipts
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Agent Tool-Call Governance ───────────────────────────────────
   Trimmed to headline + stat tiles; the two-layer-defense methodology and
   the full executed-trace breakdown now live in the Empirical Evidence
   section of /research, alongside the rest of the corpus discussion. */
function AgentGovernanceSection() {
  return (
    <section id="agent-governance" className="py-16 sm:py-24 px-4 sm:px-5" style={{ backgroundColor: '#07070d' }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
            Agent action control
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white mb-4">
            Govern every action,{' '}
            <span className="text-slate-500 font-light">not just every answer.</span>
          </h2>
          <p className="text-slate-400 text-sm max-w-xl mx-auto leading-relaxed">
            Put a constitutional control layer between an agent and its tools — file reads, SQL, shell commands, and outbound requests. Four invariants are blocked unconditionally; everything else is scored per call.
          </p>
        </div>

        <div className="rounded-2xl border p-6 sm:p-8 bg-white/[0.03] border-white/10 mb-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <span className="text-xs uppercase tracking-widest font-bold text-slate-500 font-mono">Measured, not asserted</span>
            <span className="text-[10px] font-mono text-slate-600">48-item labeled corpus · dual-axis executed-tool-call harness</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-black" style={{ color: G.gold }}>0</div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">missed injections<br/>deployed pipeline</div>
            </div>
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-black" style={{ color: G.gold }}>91.3%</div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">F1 · deployed<br/>pipeline @ 0.85</div>
            </div>
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-black text-emerald-400">4/4</div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">real attack tasks<br/>blocked, executed traces</div>
            </div>
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-black text-emerald-400">1/4</div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">blocked with utility<br/>preserved</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/console" className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all" style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
            Try the governed console
          </Link>
          <Link href="/research#empirical-evidence" className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-300 border border-white/10 hover:bg-white/5 transition-all">
            See the full breakdown
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Proof Panel — bare vs governed, same request ──────────────── */
function ProofPanel() {
  return (
    <section className="py-14 px-4 sm:px-5" style={{ backgroundColor: '#07070d' }}>
      <div className="max-w-2xl mx-auto text-center">
        <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
          Live Governance Example
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-white mb-4">
          Same prompt, bare model vs governed —{' '}
          <span className="text-slate-500 font-light">see it live, not in a screenshot.</span>
        </h2>
        <p className="text-slate-400 text-sm max-w-xl mx-auto leading-relaxed mb-6">
          Send a manipulation attempt to the console and watch the bare and governed outputs return
          side by side, with the stability margin and receipt for the governed arm.
        </p>
        <Link href="/console" className="inline-block px-6 py-3 rounded-xl text-sm font-bold transition-all" style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
          Try it in the console
        </Link>
      </div>
    </section>
  );
}

export default async function LandingPage() {
  // The benchmark strip is interactive, but its published/empty state must also
  // be correct in the server-rendered HTML. Without this preload, crawlers and
  // agents that do not execute the client bundle permanently see the component's
  // initial empty state even while /api/benchmarks has published rows.
  const benchmarkData = await fetchData<BenchmarkApiShape>('/api/benchmarks');

  return (
    <main className="min-h-screen selection:bg-amber-500/30" style={{ backgroundColor: '#07070d' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <LandingNav />
      <Hero />
      <AgentGovernanceSection />
      <BenchmarkResults compact initialData={benchmarkData} />
      <ComparisonSection />
      <ArchitectureSection />
      <ResearchHandoffSection />
      <LiveStatsBar />
      <ProofPanel />
      <section className="py-16 px-5 bg-slate-50 dark:bg-slate-950 border-y border-slate-100 dark:border-white/5">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-xs font-mono uppercase tracking-widest mb-2 font-bold" style={{ color: G.gold }}>
            Stay updated
          </p>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
            Get notified when benchmark results publish
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-500 mb-6">
            Benchmark results are live — leave your email to be notified
            when new runs publish or results are updated.
          </p>
          <LandingEmailCapture />
        </div>
      </section>
      <RedTeamSection />
      <EnterpriseSection />
      <PricingSection />

      <footer className="py-16 px-5 border-t border-white/5" style={{ backgroundColor: '#07070d' }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-10">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Lex Aureon" width={40} height={40} className="opacity-90 rounded-lg" />
            <span className="text-white font-black tracking-tighter text-lg">LEX AUREON</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-4 text-xs font-mono text-slate-400 font-bold uppercase tracking-widest">
            <Link href="/console" className="hover:text-white transition-colors">Console</Link>
            <Link href="/keys" className="hover:text-white transition-colors">API Keys</Link>
            <Link href="/benchmarks" className="hover:text-white transition-colors">Benchmarks</Link>
            {/* fix (2026-07-11): /audit existed, was live, was even referenced
                in on-page copy ("Every receipt records the constitutional
                state") -- but was linked from nowhere on the homepage. A
                visitor curious about a receipt had no path to actually see
                one. Added here, same treatment as every other real page.
                fix (2026-09-01): same pattern recurred — /observability and
                /keys were both fully built and live but linked from nowhere
                on the site (nav or footer). Added both here and to
                LandingNav for the same reason /audit was added above. */}
            <Link href="/audit" className="hover:text-white transition-colors">Audit</Link>
            <Link href="/observability" className="hover:text-white transition-colors">Observability</Link>
            <Link href="/verify" className="hover:text-white transition-colors">Verify</Link>
            <a href="https://doi.org/10.5281/zenodo.18944242" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Paper</a>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          </div>
          <div className="text-[10px] font-mono text-slate-600 font-bold">
            © 2026 Aureonics Systems · Built in Lagos
          </div>
        </div>
      </footer>
    </main>
  );
}
