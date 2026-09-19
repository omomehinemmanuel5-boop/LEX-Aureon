import type { Metadata } from 'next';
import Link from 'next/link';
import GovernanceObservatory from '@/components/GovernanceObservatory';

export const metadata: Metadata = {
  title: 'Governance Observatory — Lex Aureon',
  description: 'Live, verifiable execution history for constitutional AI governance decisions.',
};

export const dynamic = 'force-dynamic';

export default function ObservatoryPage() {
  return (
    <>
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#07070d]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-mono text-xs font-bold tracking-[.18em] text-white">LEX <span className="text-[#e8c96d]">AUREON</span></Link>
          <div className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-slate-400 sm:gap-4 sm:text-xs"><Link href="/audit" className="hidden hover:text-white sm:block">Audit index</Link><Link href="/console" className="whitespace-nowrap rounded-lg bg-gradient-to-br from-[#c9a84c] to-[#e8c96d] px-3 py-2 text-[#07070d] shadow-[0_4px_16px_rgba(201,168,76,.22)] hover:brightness-110">Open console</Link></div>
        </div>
      </nav>
      <GovernanceObservatory />
    </>
  );
}
