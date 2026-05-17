'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '@/types';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, company_name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  login: async () => {},
  register: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('lex_token');
    if (!stored) return;
    setToken(stored);
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${stored}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthUser | null) => {
        if (data) {
          setUser(data);
        } else {
          window.localStorage.removeItem('lex_token');
          setToken(null);
        }
      })
      .catch(() => {
        window.localStorage.removeItem('lex_token');
        setToken(null);
      });
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as { access_token?: string; user?: AuthUser; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Login failed');
    localStorage.setItem('lex_token', data.access_token!);
    setToken(data.access_token!);
    setUser(data.user!);
  };

  const register = async (email: string, password: string, company_name: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, company_name }),
    });
    const data = await res.json() as { access_token?: string; user?: AuthUser; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Registration failed');
    localStorage.setItem('lex_token', data.access_token!);
    setToken(data.access_token!);
    setUser(data.user!);
  };

  const logout = () => {
    localStorage.removeItem('lex_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
