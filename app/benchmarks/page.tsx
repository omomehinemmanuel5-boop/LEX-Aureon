import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import BenchmarkResults from '@/components/BenchmarkResults';

export const metadata: Metadata = {
  title: 'Benchmarks — Lex Aureon',
  description:
    'Live adversarial-evaluation results for Lex Aureon, read from the results table. Bare vs governed attack-success under a single symmetric judge across AdvBench, HarmBench, and JailbreakBench.',
  openGraph: {
    title: 'Lex Aureon — Live Benchmark Results',
    description:
      'Governed vs ungoverned attack-success under one symmetric judge. Read live from the results table; numbers appear only after a scored run is published.',
    url: 'https://lexaureon.com/benchmarks',
    type: 'website',
  },
};

const G = { gold: '#c9a84c', goldL: '#e8c96d', goldD: '#a07830' };

export default function BenchmarksPage() {
  return (
    <main className="min-h-screen selection:bg-amber-500/30" style={{ backgroundColor: '#07070d' }}>
      {/* Header */}
      <header className="px-5 pt-10 pb-2">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={32} height={32} className="opacity-90 rounded-lg" />
            <span className="text-white font-black tracking-tighter">LEX AUREON</span>
          </Link>
          <Link
            href="/console"
            className="px-4 py-2 rounded-lg text-xs font-black transition-all active:scale-95"
            style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL}, ${G.gold})`, color: '#07070d' }}
          >
            Try the console
          </Link>
        </div>
      </header>

      {/* Title */}
      <section className="px-5 pt-12 pb-6 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
            Adversarial evaluation
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-white mb-4 leading-tight">
            Benchmark results,{' '}
            <span style={{
              background: `linear-gradient(135deg, ${G.goldL}, ${G.gold}, ${G.goldD})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              live from the table.
            </span>
          </h1>
          <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
            Every figure on this page is read from the results table and refreshes on its own.
            The baseline (a direct call to the same base model, no system prompt) and the governed
            arm (the full constitutional layer) are judged by the <span className="font-bold text-slate-300">same</span> content-only
            judge on their actual output text. Each benchmark measures something different — some
            score is better lower (attack-success), some better higher (truthfulness, robustness) —
            every metric below is explicitly tagged for its own direction.
          </p>
        </div>
      </section>

      {/* Live results — full mode. fix (2026-07-10): 10s -> 30s poll; paired
          with /api/benchmarks' new 60s server-side cache (see that route's
          fix note) since results only change in discrete jumps on publish,
          not continuously -- fast polling was never buying real freshness,
          just extra Turso row reads. */}
      <BenchmarkResults pollMs={30000} />

      {/* Methodology / reproduce */}
      <section className="px-5 py-14">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border p-6 bg-[#0d0d1a] border-[#c9a84c20]">
            <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
              How these numbers are produced
            </div>
            <ul className="space-y-2.5 text-sm text-slate-400 leading-relaxed">
              <li>
                <span className="text-slate-300 font-bold">Two arms, one judge.</span> The bare arm is a
                direct call to the base model with no system prompt; the governed arm is the same prompt
                through the constitutional layer. Both outputs are scored by the same judge — no
                framework vocabulary in the refusal test, so identical complying text scores identically
                in either arm.
              </li>
              <li>
                <span className="text-slate-300 font-bold">Direction varies by metric.</span> Attack-success
                rate (AdvBench, HarmBench, JailbreakBench) is better lower — a governed model that complies
                less with harmful requests wins. Truthfulness, injection resistance, appropriate-response
                rate, and refusal robustness are better higher — a governed model that scores <em>more</em> of
                these wins. Each result below carries an explicit &ldquo;higher is better&rdquo; or &ldquo;lower is
                better&rdquo; badge so this isn&rsquo;t left to guesswork.
              </li>
              <li>
                <span className="text-slate-300 font-bold">Honest empty state.</span> When no scored run
                has been published, this page says so. It never shows a placeholder zero.
              </li>
              <li>
                <span className="text-slate-300 font-bold">Single source of truth.</span> This dashboard,
                the figures on the landing page, and the README all read the same results table. Re-running
                a suite and publishing updates them together.
              </li>
              <li>
                <span className="text-slate-300 font-bold">Reproducible.</span> Runners, scorers, and the
                publish step are open; datasets are not committed (they contain harmful prompts) but are
                downloaded from their official sources per the benchmark repo&rsquo;s REPRODUCE.md.
              </li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs font-mono">
              <a href="https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 transition-colors">
                Benchmark repo ↗
              </a>
              <a href="https://doi.org/10.5281/zenodo.18944242" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 transition-colors">
                Read the paper ↗
              </a>
              <Link href="/console" className="text-amber-500 hover:text-amber-400 transition-colors">
                Live console →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-12 px-5 border-t border-white/5" style={{ backgroundColor: '#07070d' }}>
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={28} height={28} className="opacity-80 rounded-lg" />
            <span className="text-slate-400 font-black tracking-tighter text-sm">LEX AUREON</span>
          </div>
          <div className="text-[10px] font-mono text-slate-600 font-bold">© 2026 Aureonics Systems · Built in Lagos</div>
        </div>
      </footer>
    </main>
  );
}
