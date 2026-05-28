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
  ['Constitution', '/constitution'],
  ['Research', '/research'],
  ['API', '/api-docs'],
  ['Pricing', '#pricing'],
] as const;

export default function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl"
      style={{ background: 'rgba(7,7,13,0.88)' }}
    >
      <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.png" alt="Lex Aureon" width={32} height={32} className="w-8 h-8 rounded-lg object-cover" />
          <div>
            <div className="text-sm font-bold text-white leading-none">Lex Aureon</div>
            <div
              className="text-[9px] leading-none mt-0.5"
              style={{ color: G.gold, fontFamily: 'monospace', letterSpacing: '0.1em' }}
            >
              GOVERN AI · ENSURE TRUST · DEFEND TRUTH
            </div>
          </div>
        </Link>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-6 text-xs text-slate-500">
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="hover:text-slate-200 transition-colors"
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/console"
            className="hidden sm:block text-xs font-bold px-4 py-2 rounded-lg transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
              color: '#07070d',
            }}
          >
            Open Console
          </Link>

          {/* Hamburger button (mobile) */}
          <button
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle menu"
            className="sm:hidden flex flex-col gap-1.5 p-2 rounded-lg border border-white/10 active:scale-95 transition-all"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            <span
              className="block w-5 h-px transition-all duration-200"
              style={{
                background: G.gold,
                transform: open ? 'translateY(5px) rotate(45deg)' : 'none',
              }}
            />
            <span
              className="block w-5 h-px transition-all duration-200"
              style={{
                background: G.gold,
                opacity: open ? 0 : 1,
              }}
            />
            <span
              className="block w-5 h-px transition-all duration-200"
              style={{
                background: G.gold,
                transform: open ? 'translateY(-5px) rotate(-45deg)' : 'none',
              }}
            />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          className="sm:hidden border-t border-white/5 px-5 py-4 flex flex-col gap-4"
          style={{ background: 'rgba(7,7,13,0.97)' }}
        >
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="text-sm text-slate-400 hover:text-white transition-colors font-mono"
            >
              {label}
            </a>
          ))}
          <Link
            href="/console"
            onClick={() => setOpen(false)}
            className="text-sm font-bold px-4 py-2.5 rounded-lg text-center transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
              color: '#07070d',
            }}
          >
            Open Console
          </Link>
        </div>
      )}
    </nav>
  );
}
