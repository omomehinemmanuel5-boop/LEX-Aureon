'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, kind === 'error' ? 5000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
        style={{ maxWidth: 'calc(100vw - 2rem)' }}
      >
        {toasts.map((t) => (
          <ToastPill key={t.id} kind={t.kind} message={t.message} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

function ToastPill({ kind, message }: { kind: ToastKind; message: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const palette = {
    info:    { bg: '#0a0d18', border: '#1a2040', fg: '#94a3b8', icon: 'ℹ' },
    success: { bg: '#052017', border: '#14532d', fg: '#4ade80', icon: '✓' },
    warning: { bg: '#1c1005', border: '#7c2d12', fg: '#fb923c', icon: '⚠' },
    error:   { bg: '#1a0505', border: '#7f1d1d', fg: '#f87171', icon: '✗' },
  }[kind];

  return (
    <div
      className="rounded-lg border px-4 py-3 font-mono text-xs flex items-start gap-2 pointer-events-auto shadow-lg"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.fg,
        minWidth: 220,
        maxWidth: 360,
        transform: mounted ? 'translateX(0)' : 'translateX(20px)',
        opacity: mounted ? 1 : 0,
        transition: 'transform 200ms ease-out, opacity 200ms ease-out',
      }}
    >
      <span className="font-bold flex-shrink-0">{palette.icon}</span>
      <span className="leading-relaxed break-words">{message}</span>
    </div>
  );
}
