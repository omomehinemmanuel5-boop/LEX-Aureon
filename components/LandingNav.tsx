'use client';

import { useState } from 'react';
import ThemeToggle from './ThemeToggle';
import Link from 'next/link';
import Image from 'next/image';

const G = {
  gold:  '#c9a84c',
  goldL: '#e8c96d',
};

const NAV_LINKS = [
  ['Benchmarks', '/benchmarks'],
  ['Constitution', '/constitution'],
  ['Research', '/research'],
  ['API', '/api-docs'],
  ['Pricing', '#pricing'],
] as const;

// The nav is intentionally dark on BOTH themes — a translucent near-black bar
// with light text reads cleanly whether the page body is light or dark, and it
// removes the previous light-mode background overlay hack. Text is always light
// because the bar is always dark, so contrast is guaranteed on every screen.
export default function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 backdrop-blur-xl"
      style={{ backgroundColor: 'rgba(7,7,13,0.85)' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          <Image src="/logo.png" alt="Lex Aureon" width={32} height={32} className="w-8 h-8 rounded-lg object-cover shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-black text-white leading-none">Lex Aureon</div>
            <div
              className="text-[9px] leading-none mt-1 font-bold whitespace-nowrap"
              style={{ color: G.gold, fontFamily: 'monospace', letterSpacing: '0.08em' }}
            >
              GOVERN · ENSURE TRUST · DEFEND TRUTH
            </div>
          </div>
        </Link>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-8 text-xs text-slate-300 font-black tracking-tight">
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="hover:text-white transition-colors"
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Link
            href="/console"
            className="hidden sm:block text-xs font-bold px-4 py-2 rounded-lg transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
              color: '#07070d',
              boxShadow: `0 4px 16px ${G.gold}30`,
            }}
          >
            Open Console
          </Link>

          {/* Hamburger button (mobile) — 44px touch target */}
          <button
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className="sm:hidden flex flex-col items-center justify-center gap-1.5 w-11 h-11 rounded-lg border border-white/10 active:scale-95 transition-all bg-white/5"
          >
            <span className="block w-5 h-px transition-all duration-200" style={{ background: G.gold, transform: open ? 'translateY(5px) rotate(45deg)' : 'none' }} />
            <span className="block w-5 h-px transition-all duration-200" style={{ background: G.gold, opacity: open ? 0 : 1 }} />
            <span className="block w-5 h-px transition-all duration-200" style={{ background: G.gold, transform: open ? 'translateY(-5px) rotate(-45deg)' : 'none' }} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          className="sm:hidden border-t border-white/10 px-4 py-4 flex flex-col gap-1 backdrop-blur-xl"
          style={{ background: 'rgba(7,7,13,0.98)' }}
        >
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="text-sm text-slate-300 hover:text-white active:text-white transition-colors font-mono font-bold py-3 border-b border-white/5"
            >
              {label}
            </a>
          ))}
          <Link
            href="/console"
            onClick={() => setOpen(false)}
            className="mt-3 text-sm font-bold px-4 py-3 rounded-lg text-center transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
              color: '#07070d',
              boxShadow: `0 4px 16px ${G.gold}30`,
            }}
          >
            Open Console
          </Link>
        </div>
      )}
    </nav>
  );
}
