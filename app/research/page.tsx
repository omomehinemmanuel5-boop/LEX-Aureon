import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Aureonics Research Foundation — Lex Aureon',
  description: 'Peer-reviewed research on constitutional AI governance. Aureonics: Constitutional Triadic Framework for Stable Adaptive Intelligence.',
};

const G = { gold: '#c9a84c', goldL: '#e8c96d', navy: '#07070d', navyL: '#0d0d1a' };

export default function ResearchPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: G.navy }}>

      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/5 backdrop-blur-xl"
        style={{ background: 'rgba(7,7,13,0.9)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-white text-sm">Lex Aureon</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/constitution" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Constitution</Link>
            <Link href="/console"
              className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all"
              style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
              Open Console
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="py-20 px-4 border-b border-white/5 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs font-mono uppercase tracking-widest mb-4"
            style={{ color: G.gold }}>Research Foundation</div>
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-4">
            Aureonics Research
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto leading-relaxed">
            Peer-reviewed mathematical framework for constitutional AI governance.
            Built independently. Proven formally.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-16 space-y-8">

        {/* Paper Card */}
        <div className="rounded-2xl border p-6 sm:p-8"
          style={{ borderColor: `${G.gold}25`, background: `${G.gold}05` }}>
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: `${G.gold}15`, border: `1px solid ${G.gold}30` }}>📄</div>
            <div>
              <h2 className="text-lg font-bold text-white mb-1">
                Aureonics: Constitutional Triadic Framework for Stable Adaptive Intelligence
              </h2>
              <p className="text-slate-500 text-sm">Emmanuel King · Independent Research · 2026</p>
            </div>
          </div>

          <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, transparent, ${G.gold}40, transparent)` }}/>

          <div className="space-y-2 font-mono text-sm mb-6">
            {[
              ['DOI', 'doi.org/10.5281/zenodo.18944242', 'https://doi.org/10.5281/zenodo.18944242'],
              ['ORCID', 'orcid.org/0009-0000-2986-4935', 'https://orcid.org/0009-0000-2986-4935'],
              ['Author', 'Emmanuel King · Lagos, Nigeria', null],
              ['Contact', 'lexaureon@gmail.com', 'mailto:lexaureon@gmail.com'],
            ].map(([label, value, href]) => (
              <div key={label!} className="flex gap-4">
                <span className="text-slate-600 w-16 flex-shrink-0">{label}</span>
                {href ? (
                  <a href={href} target={href.startsWith('http') ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity"
                    style={{ color: G.gold }}>{value}</a>
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
        <div className="rounded-2xl border border-white/6 p-6" style={{ background: G.navyL }}>
          <div className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: G.gold }}>Abstract</div>
          <p className="text-slate-400 text-sm leading-relaxed">
            We present Aureonics, a constitutional triadic framework for stable adaptive intelligence. 
            The framework models AI system health as a probability simplex over three irreducible invariants: 
            Continuity (C), Reciprocity (R), and Sovereignty (S), constrained such that C+R+S=1. 
            The stability margin M=min(C,R,S) provides a scalar measure of constitutional health. 
            We introduce the Dynamic CRS Governor — a Control Barrier Function-based control system 
            that detects constitutional drift before failure and applies mass-conserving corrections 
            to restore stability. The framework is operationalized into a five-agent PRAXIS pipeline 
            with cryptographic audit receipts, Lyapunov stability certificates, and real-time 
            constitutional monitoring. We demonstrate that the system is mathematically bounded, 
            falsifiable, and deployable as a governance layer for production language models.
          </p>
        </div>

        {/* Math Framework */}
        <div className="rounded-2xl border border-white/6 p-6" style={{ background: G.navyL }}>
          <div className="text-xs font-mono uppercase tracking-widest mb-5" style={{ color: G.gold }}>Mathematical Framework</div>
          <div className="space-y-4">
            {[
              { formula: 'C + R + S = 1', desc: 'Constitutional simplex constraint — state always normalized on probability simplex', color: '#3b82f6' },
              { formula: 'M = min(C, R, S)', desc: 'Stability margin — system is only as stable as its weakest invariant', color: '#10b981' },
              { formula: 'M < τ = 0.08', desc: 'Hard collapse threshold — CBF governor fires and applies correction', color: '#ef4444' },
              { formula: 'ḣ(x) + α·h(x) ≥ 0', desc: 'Control Barrier Function constraint — always enforced during projection', color: G.gold },
              { formula: '‖dx/dt‖ > δ', desc: 'Velocity trigger — detects rapid constitutional drift before collapse', color: '#a855f7' },
              { formula: 'V(x) = ‖x - x*‖²', desc: 'Lyapunov candidate — stability certificate, δV < 0 guarantees convergence', color: '#06b6d4' },
            ].map(({ formula, desc, color }) => (
              <div key={formula} className="flex gap-4 items-start">
                <code className="text-sm font-mono font-bold flex-shrink-0 w-52"
                  style={{ color }}>{formula}</code>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* BibTeX */}
        <div className="rounded-2xl border border-white/6 p-6" style={{ background: G.navyL }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-mono uppercase tracking-widest" style={{ color: G.gold }}>Cite This Work</div>
          </div>
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
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/console"
            className="flex-1 text-center py-3 rounded-xl text-sm font-bold transition-all"
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
