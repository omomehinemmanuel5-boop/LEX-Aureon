'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '@/types';

interface AuthState {
  user: AuthUser | null;
  /** Account credentials stay in an HttpOnly cookie and are never exposed to client JavaScript. */
  token: null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, company_name: string) => Promise<string>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  login: async () => {},
  register: async () => '',
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<AuthUser> : null)
      .then((account) => setUser(account))
      .catch(() => setUser(null));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as { user?: AuthUser; error?: string };
    if (!res.ok || !data.user) throw new Error(data.error ?? 'Sign-in failed');
    setUser(data.user);
  };

  const register = async (email: string, password: string, company_name: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, company_name }),
    });
    const data = await res.json() as { message?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Registration failed');
    return data.message ?? 'Check your email for an account verification link.';
  };

  const logout = () => {
    setUser(null);
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  };

  return (
    <AuthContext.Provider value={{ user, token: null, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
