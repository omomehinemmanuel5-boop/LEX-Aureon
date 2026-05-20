import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Lex Aureon — Constitution v1.0',
  description: 'The constitutional framework governing all Lex Aureon AI outputs. Seven articles establishing sovereign authority, audit continuity, and constitutional separation of powers.',
};

const ARTICLES = [
  {
    number: 'I',
    title: 'Scope of Authority',
    text: 'Lex Aureon governs the orchestration, verification, and audit of all AI-assisted outputs. It does not claim intelligence, consciousness, or autonomous agency. It operates strictly as a policy-enforcing and audit-generating system.',
    math: null,
    mathSub: null,
    pillars: ['Governance', 'Audit', 'Policy'],
    color: 'blue',
  },
  {
    number: 'II',
    title: 'Sovereign Authority',
    text: 'Final authority over constitutional state resides exclusively with the Lex Governor under the Aureonics protocol. No external model, subsystem, or user input may directly mutate canonical state. All state changes must pass through the constitutional kernel.',
    math: 'C + R + S = 1',
    mathSub: 'State is always normalized. Constitutional mass is conserved.',
    pillars: ['Sovereignty', 'State Control', 'Immutability'],
    color: 'purple',
  },
  {
    number: 'III',
    title: 'Separation of Powers',
    text: 'Generation, governance, and audit are constitutionally separated. The raw generator produces without constraint. The governor evaluates and corrects. The auditor records and signs. No single component may generate, govern, and approve the same output.',
    math: 'Generator → Governor → Auditor',
    mathSub: 'Three powers. No overlap. No single point of constitutional failure.',
    pillars: ['Separation', 'Independence', 'Checks & Balances'],
    color: 'emerald',
  },
  {
    number: 'IV',
    title: 'Audit and Continuity',
    text: 'Every governed output produces an immutable audit receipt containing the state before, the state after, the stability margin, and cryptographic hashes of both raw and governed outputs. These receipts constitute the canonical historical record and supersede all transient memory.',
    math: 'receipt = SHA256(input) ⊕ SHA256(output) ⊕ Δ(C,R,S)',
    mathSub: 'Nothing is hidden. Everything is provable.',
    pillars: ['Transparency', 'Immutability', 'Traceability'],
    color: 'amber',
  },
  {
    number: 'V',
    title: 'Constitutional Stability',
    text: 'An output is constitutionally stable if and only if the stability margin M = min(C, R, S) is greater than or equal to the constitutional threshold τ. When M falls below τ, the Control Barrier Function governor fires and applies mass-conserving corrections to restore constitutional equilibrium.',
    math: 'M = min(C, R, S) ≥ τ = 0.08',
    mathSub: 'ḣ(x) + α·h(x) ≥ 0 — CBF constraint always enforced.',
    pillars: ['Lyapunov Stability', 'CBF Enforcement', 'Floor τ = 0.08'],
    color: 'cyan',
  },
  {
    number: 'VI',
    title: 'Human Authority',
    text: 'Human operators retain ultimate oversight. The system surfaces all interventions, all trigger reasons, and all metric changes transparently. No governance action is hidden. The human may always inspect, challenge, or override any governed output through explicit interaction.',
    math: null,
    mathSub: null,
    pillars: ['Human Override', 'Full Transparency', 'Explainability'],
    color: 'slate',
  },
  {
    number: 'VII',
    title: 'Evolvable Components',
    text: 'Models, prompts, tools, and configurations may evolve across versions. Audit integrity, constitutional precedence, and authority boundaries are immutable. This constitution becomes effective upon system instantiation and remains binding across all future versions of Lex Aureon.',
    math: 'Kernel evolves. Constitution endures.',
    mathSub: 'SovereignKernel-v2 · Aureonics Framework · 2025',
    pillars: ['Versioning', 'Immutable Law', 'Forward Binding'],
    color: 'rose',
  },
];

type ColorKey = 'blue'|'purple'|'emerald'|'amber'|'cyan'|'slate'|'rose';

const COLOR_MAP: Record<ColorKey, {
  border: string; bg: string; text: string; pill: string; num: string;
}> = {
  blue:    { border:'border-blue-800/40',    bg:'bg-blue-900/[0.08]',    text:'text-blue-400',    pill:'bg-blue-900/20 border-blue-800/40 text-blue-300',    num:'text-blue-500'    },
  purple:  { border:'border-purple-800/40',  bg:'bg-purple-900/[0.08]',  text:'text-purple-400',  pill:'bg-purple-900/20 border-purple-800/40 text-purple-300',  num:'text-purple-500'  },
  emerald: { border:'border-emerald-800/40', bg:'bg-emerald-900/[0.08]', text:'text-emerald-400', pill:'bg-emerald-900/20 border-emerald-800/40 text-emerald-300', num:'text-emerald-500' },
  amber:   { border:'border-amber-800/40',   bg:'bg-amber-900/[0.08]',   text:'text-amber-400',   pill:'bg-amber-900/20 border-amber-800/40 text-amber-300',   num:'text-amber-500'   },
  cyan:    { border:'border-cyan-800/40',    bg:'bg-cyan-900/[0.08]',    text:'text-cyan-400',    pill:'bg-cyan-900/20 border-cyan-800/40 text-cyan-300',    num:'text-cyan-500'    },
  slate:   { border:'border-slate-700/40',   bg:'bg-slate-800/20',       text:'text-slate-300',   pill:'bg-slate-800/40 border-slate-700 text-slate-400',   num:'text-slate-500'   },
  rose:    { border:'border-rose-800/40',    bg:'bg-rose-900/[0.08]',    text:'text-rose-400',    pill:'bg-rose-900/20 border-rose-800/40 text-rose-300',    num:'text-rose-500'    },
};

export default function ConstitutionPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: '#07070d' }}>

      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/5 backdrop-blur-xl"
        style={{ background: 'rgba(7,7,13,0.9)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={32} height={32} className="w-8 h-8 rounded-lg object-cover" />
            <span className="font-bold text-white text-sm">Lex Aureon</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-600 font-mono hidden sm:inline">CONSTITUTION v1.0</span>
            <Link href="/console"
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors">
              Open Console
            </Link>
          </div>
        </div>
      </nav>

      {/* Preamble */}
      <header className="py-20 px-4 border-b border-white/5">
        <div className="max-w-3xl mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border border-blue-700/30 flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">⚖</span>
          </div>
          <div className="text-xs text-blue-400 font-mono font-semibold uppercase tracking-widest mb-4">
            Constitutional Document · Ratified 2025
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-2 leading-tight">
            Lex Aureon
          </h1>
          <p className="text-2xl text-slate-500 font-light mb-8">Constitution v1.0</p>

          <div className="rounded-2xl border border-white/8 p-6 text-left max-w-2xl mx-auto"
            style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="text-xs text-slate-500 font-mono uppercase tracking-widest mb-3">Preamble</div>
            <p className="text-sm text-slate-300 leading-relaxed italic">
              &ldquo;Lex Aureon is a governance system for AI-assisted decision-making in
              regulated environments. Its purpose is to ensure that outputs produced by
              artificial intelligence are lawful, auditable, jurisdiction-aware, and
              defensible over time.&rdquo;
            </p>
            <div className="mt-4 pt-4 border-t border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <span className="text-xs text-slate-600 font-mono">Emmanuel King · Principal Researcher · Aureonics</span>
              <span className="text-xs text-slate-600 font-mono">Lagos, Nigeria · 2025</span>
            </div>
          </div>
        </div>
      </header>

      {/* Articles */}
      <main className="py-16 px-4">
        <div className="max-w-3xl mx-auto space-y-5">
          {ARTICLES.map((article) => {
            const c = COLOR_MAP[article.color as ColorKey];
            return (
              <article key={article.number}
                className={`rounded-2xl border p-6 sm:p-8 ${c.border} ${c.bg}`}>
                <div className="flex items-start gap-4 mb-5">
                  <div className={`flex-shrink-0 text-5xl font-black font-mono leading-none mt-0.5 opacity-20 ${c.num}`}>
                    {article.number}
                  </div>
                  <div>
                    <div className="text-xs text-slate-600 font-mono uppercase tracking-widest mb-1">
                      Article {article.number}
                    </div>
                    <h2 className={`text-xl font-bold ${c.text}`}>{article.title}</h2>
                  </div>
                </div>

                <p className="text-sm text-slate-300 leading-relaxed mb-5">{article.text}</p>

                {article.math && (
                  <div className="rounded-xl border border-white/5 p-4 mb-5 font-mono"
                    style={{ background: 'rgba(0,0,0,0.35)' }}>
                    <div className={`text-sm font-bold ${c.text} mb-1`}>{article.math}</div>
                    {article.mathSub && (
                      <div className="text-xs text-slate-500">{article.mathSub}</div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {article.pillars.map(p => (
                    <span key={p}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium ${c.pill}`}>
                      {p}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </main>

      {/* Ratification */}
      <section className="py-20 px-4 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-600/20 to-orange-600/20 border border-amber-700/30 flex items-center justify-center mx-auto mb-6">
            <span className="text-xl">✦</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">Ratification</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-8 max-w-xl mx-auto">
            This Constitution becomes effective upon system instantiation and remains binding
            across all versions of Lex Aureon. The mathematical framework is grounded in
            published research and enforced by the SovereignKernel on every governed output.
          </p>

          {/* Enforcement block */}
          <div className="rounded-2xl border border-white/6 p-5 text-left mb-8 font-mono text-xs"
            style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="text-slate-500 mb-3 uppercase tracking-wider text-xs">Enforcement Layer</div>
            <div className="space-y-2 text-slate-400">
              {[
                ['kernel',    'SovereignKernel-v2 · Aureonics Framework'],
                ['stability', 'Lyapunov-certified · δV monitored per run'],
                ['cbf',       'ḣ(x) + α·h(x) ≥ 0 · always enforced'],
                ['floor',     'τ = 0.08 · soft floor = 0.05 · CBF floor = 0.05'],
                ['audit',     'SHA-256 signed · immutable · per-run receipt'],
                ['author',    'Emmanuel King · ORCID 0009-0000-2986-4935'],
              ].map(([key, val]) => (
                <div key={key} className="flex gap-3">
                  <span className="text-slate-600 w-16 flex-shrink-0">{key}</span>
                  <span>{val}</span>
                </div>
              ))}
              <div className="flex gap-3">
                <span className="text-slate-600 w-16 flex-shrink-0">doi</span>
                <a href="https://doi.org/10.5281/zenodo.18944243"
                  target="_blank" rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors">
                  10.5281/zenodo.18944243
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/console"
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-blue-500 hover:to-cyan-500 transition-all text-sm text-center">
              ⚡ Try the governed console
            </Link>
            <a href="https://doi.org/10.5281/zenodo.18944243"
              target="_blank" rel="noopener noreferrer"
              className="px-6 py-3 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-medium rounded-xl transition-all text-sm text-center">
              📄 Read the research paper ↗
            </a>
            <a href="mailto:lexaureon@gmail.com?subject=Enterprise Inquiry - Lex Aureon"
              className="px-6 py-3 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-medium rounded-xl transition-all text-sm text-center">
              ✉ Enterprise licensing
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <Link href="/" className="hover:text-slate-400 transition-colors">Home</Link>
            <Link href="/console" className="hover:text-slate-400 transition-colors">Console</Link>
            <a href="https://doi.org/10.5281/zenodo.18944243" target="_blank" rel="noopener noreferrer"
              className="hover:text-slate-400 transition-colors">Research</a>
          </div>
          <span className="text-xs text-slate-700 font-mono">
            © 2025 Aureonics · Constitution v1.0 · Immutable
          </span>
        </div>
      </footer>
    </div>
  );
}
