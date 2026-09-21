import Link from 'next/link';
import Image from 'next/image';
import ErrorBoundary from '@/components/ErrorBoundary';
import SimplexVisualizer from '@/components/SimplexVisualizer';
import HeroTicker from '@/components/HeroTicker';
import LandingNav from '@/components/LandingNav';
import DecisionLab from '@/components/DecisionLab';
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
          Govern every consequential<br className="hidden sm:block" /> AI decision.{' '}
          <span className="shimmer-gold">
            Prove what happened.
          </span>
        </h1>

        <p className="text-xs font-mono mb-5 tracking-widest" style={{ color: G.gold, opacity: 0.85 }}>
          Built from Lagos · Independent engineering · Open evidence
        </p>

        <p className="text-slate-300 text-base sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Lex is the decision and evidence layer between an AI system and the world.
          Evaluate model responses and agent actions before they reach users, tools, or production systems — then inspect the receipt.
        </p>

        <div className="mx-auto mb-8 max-w-2xl rounded-2xl border border-[#c9a84c]/35 bg-[#c9a84c]/[0.08] px-5 py-4">
          <div className="text-sm font-mono font-black tracking-[0.12em] text-[#e8c96d] sm:text-base">CORRECT BEFORE THE FACT. PROVE AFTER.</div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300 sm:text-sm">Lex Aureon intervenes before an unsafe answer is returned or a risky agent action executes — then records what happened in an inspectable receipt.</p>
        </div>

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
            ⚡ Run a governed decision
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
          className="inline-flex min-h-11 max-w-[92vw] items-center justify-center gap-2 rounded-full border border-[#c9a84c]/40 bg-[#c9a84c]/10 px-4 py-2.5 text-center text-xs font-bold text-[#e8c96d] transition hover:border-[#e8c96d]/70 hover:bg-[#c9a84c]/20 sm:text-sm"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M7.8 16.2l2.1-6.3 6.3-2.1-2.1 6.3-6.3 2.1Z" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          Explore the Governance Observatory <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="relative z-10 flex justify-center items-center w-full mt-6 opacity-80">
        <ErrorBoundary label="Simplex"><SimplexVisualizer /></ErrorBoundary>
      </div>
    </section>
  );
}

/* ── Product Modes ──────────────────────────────────────────────── */
function ProductModesSection() {
  return (
    <section id="product" className="scroll-mt-20 border-y border-[#c9a84c]/15 bg-[#0d0d1a] px-4 py-16 sm:px-5 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <div className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#e8c96d]">One layer · two control points</div>
          <h2 className="mt-4 text-3xl font-black text-white sm:text-5xl">Govern the response. Govern the action.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300">Lex sits at the boundary where an AI decision becomes visible to a person or executable by a tool.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-blue-400/25 bg-blue-400/[0.05] p-6">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-blue-300">01 · Response boundary</div>
            <h3 className="mt-3 text-xl font-black text-white">Before an answer reaches a user.</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">Evaluate model output for manipulation, drift, and constitutional pressure, then return the answer, an intervention, or a clear refusal.</p>
            <Link href="/console" className="mt-5 inline-block text-sm font-bold text-[#e8c96d]">Try text governance →</Link>
          </div>
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.05] p-6">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-emerald-300">02 · Action boundary</div>
            <h3 className="mt-3 text-xl font-black text-white">Before an action reaches a tool.</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">Intercept file, database, shell, web, and multi-step agent actions before execution, with scope, risk, and trajectory checks.</p>
            <Link href="#paths" className="mt-5 inline-block text-sm font-bold text-[#e8c96d]">Explore agent governance →</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function GovernanceFlowSection() {
  const steps = [
    { number: '01', title: 'Detect', text: 'Identify constitutional pressure before an output is returned or an agent tool executes.', accent: G.C },
    { number: '02', title: 'Correct', text: 'Apply the minimum necessary intervention at the control boundary, not after the incident.', accent: G.R },
    { number: '03', title: 'Prove', text: 'Record the decision, state, and outcome in a cryptographic audit receipt.', accent: G.gold },
  ];

  return (
    <section className="py-20 sm:py-24 px-4 sm:px-5" style={{ backgroundColor: '#07070d' }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>Before the fact · not after the incident</div>
          <h2 className="text-3xl sm:text-5xl font-black text-white mb-4">Detect. Correct. Prove.</h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Lex Aureon turns an invisible safety decision into an inspectable operating path — without retraining the model or hiding the boundary of the evidence.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-5">
          {steps.map((step, index) => (
            <div key={step.number} className="relative rounded-2xl border border-[#c9a84c]/25 bg-white/[0.035] p-6 card-hover">
              {index < steps.length - 1 && <div className="hidden md:block absolute top-10 -right-3 z-10 h-px w-6" style={{ background: `linear-gradient(90deg, ${G.gold}80, transparent)` }} />}
              <div className="flex items-center justify-between mb-5">
                <span className="font-mono text-xs font-bold tracking-[0.2em]" style={{ color: G.goldL }}>{step.number}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: step.accent, boxShadow: `0 0 14px ${step.accent}99` }} />
              </div>
              <h3 className="text-xl font-black text-white mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{step.text}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-stretch">
          <div className="rounded-2xl border border-[#c9a84c]/20 bg-[#c9a84c]/[0.04] p-5 sm:p-6">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] font-bold mb-3" style={{ color: G.goldL }}>Audit receipt preview</div>
            <div className="grid sm:grid-cols-3 gap-2 text-xs font-mono">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-slate-500">decision</div><div className="mt-1 text-emerald-300">constitutional pass</div></div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-slate-500">state</div><div className="mt-1 text-[#e8c96d]">C + R + S = 1</div></div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-slate-500">integrity</div><div className="mt-1 text-[#e8c96d]">SHA-256 receipt</div></div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">Every governed turn can carry its constitutional state, intervention outcome, and integrity record into reviewable evidence.</p>
          </div>
          <Link href="/audit" className="flex min-h-12 items-center justify-center rounded-xl border border-[#c9a84c]/45 px-5 text-sm font-bold text-[#e8c96d] transition hover:bg-[#c9a84c]/10">Inspect audit receipts →</Link>
        </div>
      </div>
    </section>
  );
}

function ProofBoundarySection() {
  return (
    <section className="px-4 py-8 sm:px-5 sm:py-10" style={{ backgroundColor: '#07070d' }}>
      <div className="mx-auto max-w-5xl rounded-2xl border border-[#c9a84c]/25 bg-[#c9a84c]/[0.04] p-5 sm:p-6">
        <div className="grid gap-5 md:grid-cols-[auto_1fr_1fr] md:items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 font-mono text-lg font-black text-[#e8c96d]">◎</div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] font-bold text-[#e8c96d]">Evidence boundary</div>
            <h2 className="mt-1 text-lg font-black text-white">Strong claims, clearly scoped.</h2>
          </div>
          <div className="grid gap-2 text-xs leading-relaxed sm:grid-cols-2 md:col-span-1">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-slate-200"><span className="font-mono font-bold text-emerald-300">PROVEN</span><br />Single-pillar Lyapunov result and numerical CBF certificate.</div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-slate-200"><span className="font-mono font-bold text-amber-300">OPEN</span><br />General multi-pillar analytical proof remains an active research boundary.</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalConversionSection() {
  return (
    <section className="px-4 py-10 sm:px-5 sm:py-14" style={{ backgroundColor: '#07070d' }}>
      <div className="mx-auto max-w-4xl rounded-3xl border border-[#c9a84c]/35 bg-[#c9a84c]/[0.06] p-7 text-center sm:p-10">
        <div className="text-xs font-mono uppercase tracking-[0.2em] font-bold text-[#e8c96d]">Your next governed run</div>
        <h2 className="mt-4 text-2xl font-black text-white sm:text-4xl">Correct before the fact. Prove after.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">Try Explorer free, see the control point in action, and move to Sovereign when your AI system reaches production.</p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/console" className="w-full rounded-xl px-6 py-3 text-sm font-black transition-all sm:w-auto" style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d', boxShadow: `0 8px 28px ${G.gold}30` }}>Try Explorer free →</Link>
          <Link href="/research" className="w-full rounded-xl border border-white/15 px-6 py-3 text-sm font-bold text-slate-200 transition hover:border-[#e8c96d]/60 hover:text-white sm:w-auto">Read the evidence</Link>
        </div>
      </div>
    </section>
  );
}


function ProductPathsSection() {
  const paths = [
    { title: 'Build with Lex', text: 'Connect through the API, MCP, and developer keys.', href: '/api-docs', label: 'Read API docs' },
    { title: 'Govern agents', text: 'Inspect tool interception, trajectories, and executed traces.', href: '/research#empirical-evidence', label: 'See agent evidence' },
    { title: 'Inspect the evidence', text: 'Read the research boundary, benchmarks, and audit receipts in context.', href: '/research', label: 'Open research' },
    { title: 'Deploy with a team', text: 'Explore shared controls, observability, and enterprise access.', href: 'mailto:lexaureon@gmail.com', label: 'Contact the team' },
  ];
  return (
    <section id="paths" className="bg-[#07070d] px-4 py-16 sm:px-5 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-9 text-center"><div className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#e8c96d]">Choose your next step</div><h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">Go deeper only where you need to.</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {paths.map((path) => <Link key={path.title} href={path.href} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#e8c96d]/50 hover:bg-[#c9a84c]/[0.06]"><div className="text-lg font-black text-white">{path.title}</div><p className="mt-2 text-sm leading-relaxed text-slate-400">{path.text}</p><div className="mt-4 text-sm font-bold text-[#e8c96d] group-hover:text-white">{path.label} →</div></Link>)}
        </div>
      </div>
    </section>
  );
}

export default async function LandingPage() {
  // The benchmark strip is interactive, but its published/empty state must also
  // be correct in the server-rendered HTML. Without this preload, crawlers and
  // agents that do not execute the client bundle permanently see the component's
  // initial empty state even while /api/benchmarks has published rows.
  return (
    <main className="min-h-screen selection:bg-amber-500/30" style={{ backgroundColor: '#07070d' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <LandingNav />
      <Hero />
      <DecisionLab />
      <ProductModesSection />
      <GovernanceFlowSection />
      <ProofBoundarySection />
      <ProductPathsSection />
      <FinalConversionSection />

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
