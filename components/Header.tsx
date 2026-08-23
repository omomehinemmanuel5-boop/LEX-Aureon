'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import AuthModal from './AuthModal';

const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
const PLAN_CLASS: Record<string, string> = {
  free: 'bg-slate-700 text-slate-300',
  pro: 'bg-blue-900/40 text-blue-300 border border-blue-700',
  enterprise: 'bg-purple-900/40 text-purple-300 border border-purple-700',
};

function planLimit(plan: string | undefined) {
  if (plan === 'pro') return 2000;
  if (plan === 'enterprise') return null; // unlimited
  return 10;
}

export default function Header({ apiCalls }: { apiCalls: number }) {
  const { user, logout } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const limit = planLimit(user?.plan);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Lex Aureon
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Governed Intelligence & Safety Monitoring
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors hidden sm:block"
            >
              About
            </Link>
            <Link
              href="/observability"
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors hidden sm:block"
            >
              Observability
            </Link>
            {user ? (
              <div className="text-right">
                <div className="flex items-center gap-2 justify-end mb-1">
                  <span className="text-xs text-slate-400 hidden sm:block truncate max-w-[180px]">
                    {user.email}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_CLASS[user.plan ?? "free"] ?? PLAN_CLASS.free}`}
                  >
                    {PLAN_LABEL[user.plan ?? "free"] ?? user.plan}
                  </span>
                </div>
                <div className="flex items-center gap-3 justify-end">
                  <div className="text-xs text-slate-400">
                    Runs:{' '}
                    <span className="text-blue-400 font-mono">
                      {apiCalls}
                      {limit !== null ? `/${limit}` : ''}
                    </span>
                  </div>
                  <button
                    onClick={logout}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-slate-400">API Calls Used</div>
                  <div className="text-2xl sm:text-3xl font-bold text-blue-400">
                    {apiCalls}
                    <span className="text-sm text-slate-500">/10</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowAuth(true)}
                  className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
