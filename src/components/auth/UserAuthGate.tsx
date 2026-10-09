'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Lock, Unlock, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { SalomonEmblem } from '@/components/SalomonLogo';

interface UserAuthContextType {
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const UserAuthContext = createContext<UserAuthContextType>({
  isAuthenticated: false,
  logout: async () => {},
});

export const useUserAuth = () => useContext(UserAuthContext);

interface UserAuthGateProps {
  children: React.ReactNode;
}

export function UserAuthGate({ children }: UserAuthGateProps) {
  const [checkingAuth, setCheckingAuth]   = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword]           = useState('');
  const [showPassword, setShowPassword]   = useState(false);
  const [error, setError]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [locked, setLocked]               = useState(false);
  const [shake, setShake]                 = useState(false);
  const [unlocking, setUnlocking]         = useState(false);
  const inputRef                          = useRef<HTMLInputElement>(null);

  // ── Session check on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    try {
      if (sessionStorage.getItem('salomon_user_auth') === '1') {
        setAuthenticated(true);
      }
    } catch {}

    fetch('/api/auth/check')
      .then((r) => r.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.authenticated) {
          setAuthenticated(true);
          try { sessionStorage.setItem('salomon_user_auth', '1'); } catch {}
        } else {
          setAuthenticated(false);
          try { sessionStorage.removeItem('salomon_user_auth'); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => { if (isMounted) setCheckingAuth(false); });

    return () => { isMounted = false; };
  }, []);

  // ── Auto-focus the input when the gate becomes visible ────────────────────
  useEffect(() => {
    if (!checkingAuth && !authenticated) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [checkingAuth, authenticated]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submitPassword = useCallback(async (candidate: string) => {
    if (locked || loading || !candidate.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: candidate }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        try { sessionStorage.setItem('salomon_user_auth', '1'); } catch {}
        setUnlocking(true);
        setTimeout(() => {
          setAuthenticated(true);
          setPassword('');
          setUnlocking(false);
        }, 500);
      } else if (res.status === 429) {
        setLocked(true);
        setError(data.message || '試行回数上限に達しました。時間をおいて再度お試しください。');
        triggerShake();
      } else {
        triggerShake();
        setPassword('');
        if (data.locked) setLocked(true);
        setError(
          data.message ||
          (data.remainingAttempts !== undefined
            ? `パスワードが正しくありません。残り試行回数: ${data.remainingAttempts}回`
            : '認証に失敗しました。正しいパスワードを入力してください。')
        );
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } catch {
      setError('サーバー通信エラーが発生しました。接続を確認してください。');
      triggerShake();
    } finally {
      setLoading(false);
    }
  }, [locked, loading]);

  // ── Enter key handler ──────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitPassword(password);
    }
  };

  // ── Logout ─────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try { await fetch('/api/auth', { method: 'DELETE' }); } catch {}
    try { sessionStorage.removeItem('salomon_user_auth'); } catch {}
    setAuthenticated(false);
    setPassword('');
    setError('');
  };

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (checkingAuth) {
    return (
      <div className="fixed inset-0 bg-[#070D1E] flex flex-col items-center justify-center z-50">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-salomon-cyan/20 border-t-salomon-cyan animate-spin" />
          <SalomonEmblem className="w-8 h-8 text-white absolute" />
        </div>
        <p className="mt-4 text-xs font-mono tracking-widest text-salomon-cyan uppercase animate-pulse">
          AUTHENTICATING SYSTEM...
        </p>
      </div>
    );
  }

  // ── Already authenticated ──────────────────────────────────────────────────
  if (authenticated) {
    return (
      <UserAuthContext.Provider value={{ isAuthenticated: true, logout: handleLogout }}>
        {children}
      </UserAuthContext.Provider>
    );
  }

  // ── Login gate ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-[#070D1E] flex items-center justify-center px-4 overflow-hidden z-50">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-salomon-cyan/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-10 right-10 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize:  '32px 32px',
          }}
        />
      </div>

      {/* Card */}
      <div
        className={`relative w-full max-w-sm rounded-2xl p-7 transition-all duration-300 ${
          shake    ? 'animate-shake'          : ''
        } ${unlocking ? 'scale-95 opacity-50' : 'scale-100 opacity-100'}`}
        style={{
          background:    'rgba(11, 20, 38, 0.88)',
          backdropFilter:'blur(20px)',
          border:        '1px solid rgba(0, 200, 255, 0.28)',
          boxShadow:     '0 20px 60px -10px rgba(0,0,0,0.8), 0 0 50px rgba(0,200,255,0.12)',
        }}
      >
        {/* 
        <div className="text-center space-y-2 mb-6">
          <div className="flex items-center justify-center gap-2">
            <SalomonEmblem className="w-5 h-5 text-white" />
            <span className="text-lg font-black tracking-[0.18em] text-white">SALOMON</span>
          </div>

          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-salomon-cyan/10 border border-salomon-cyan/30 text-salomon-cyan my-1">
            {unlocking
              ? <Unlock className="w-5 h-5 text-emerald-400 animate-bounce" />
              : <Lock   className="w-5 h-5" />
            }
          </div>

          <div>
            <h1 className="text-sm font-bold text-white tracking-wide">高尾山 AI コンシェルジュ</h1>
            <p className="text-xs text-slate-400 mt-1">パスワードを入力して開始してください</p>
          </div>
        </div>
        */}

        {/* Input row */}
        <div className="space-y-3">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              disabled={loading || locked}
              placeholder="パスワードを入力"
              autoComplete="current-password"
              className={`w-full pl-4 pr-24 py-3 rounded-xl text-white text-sm font-mono
                          placeholder-slate-600 outline-none transition-all
                          bg-[#060D1E]/90 border disabled:opacity-40
                          ${error
                            ? 'border-rose-500/60 focus:border-rose-500'
                            : 'border-slate-700/80 focus:border-salomon-cyan/60 focus:ring-1 focus:ring-salomon-cyan/20'
                          }`}
            />

            {/* Show/hide toggle */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              className="absolute right-12 p-1.5 text-slate-500 hover:text-white transition-colors"
              aria-label={showPassword ? 'パスワードを非表示' : 'パスワードを表示'}
            >
              {showPassword
                ? <EyeOff className="w-4 h-4" />
                : <Eye    className="w-4 h-4" />
              }
            </button>

            {/* Submit button */}
            <button
              type="button"
              onClick={() => submitPassword(password)}
              disabled={loading || locked || !password.trim()}
              className="absolute right-1.5 h-8 w-8 flex items-center justify-center
                         rounded-lg bg-salomon-cyan hover:bg-salomon-cyan/90 active:scale-95
                         text-salomon-black transition-all shadow-glow-cyan
                         disabled:opacity-30 disabled:pointer-events-none"
              aria-label="認証"
            >
              {loading
                ? <Loader2   className="w-4 h-4 animate-spin" />
                : <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              }
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30
                            text-rose-300 text-xs text-center flex items-center
                            justify-center gap-1.5 animate-fadeIn">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
