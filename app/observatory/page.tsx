import type { Metadata } from 'next';
import Link from 'next/link';
import GovernanceObservatory from '@/components/GovernanceObservatory';

export const metadata: Metadata = {
  title: 'Governance Observatory — Lex Aureon',
  description: 'Live, verifiable execution history for constitutional AI governance decisions.',
};

export default function ObservatoryPage() {
  return (
    <>
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#07070d]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-mono text-xs font-bold tracking-[.18em] text-white">LEX <span className="text-indigo-300">AUREON</span></Link>
          <div className="flex items-center gap-4 text-xs font-bold text-slate-400"><Link href="/audit" className="hover:text-white">Audit index</Link><Link href="/console" className="rounded-lg bg-indigo-300 px-3 py-2 text-[#101126] hover:bg-indigo-200">Open console</Link></div>
        </div>
      </nav>
      <GovernanceObservatory />
    </>
  );
}
