'use client';
import React, { useState } from 'react';
import { COINS } from '@/lib/crypto_coins';

const G = { gold: '#c9a84c', goldL: '#e8c96d', navy: '#07070d', surface: '#0f1017', border: '#1a2030' };

export default function BitcoinUpgradeModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'select' | 'pay' | 'confirm' | 'done'>('select');
  const [selected, setSelected] = useState(COINS[0]);
  const [txId, setTxId] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ status: string; reason: string } | null>(null);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submit = async () => {
    if (!txId.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, source: 'crypto_upgrade',
          txId: txId.trim(), coin: selected.symbol,
          plan: 'sovereign', amount: `${selected.amount} ${selected.symbol}`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.verification) setVerifyResult(data.verification);
    } catch { /* continue — the done screen still shows; admin can review manually */ }
    setStep('done');
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: G.surface, border: `1px solid ${G.border}` }}>

        {/* Header */}
        <div className="flex items-center justify-between p-5" style={{ borderBottom: `1px solid ${G.border}` }}>
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.15em', color: G.gold, textTransform: 'uppercase' }}>
              Upgrade to Sovereign
            </p>
            <h2 className="text-white font-bold text-lg mt-0.5">
              {step === 'select' ? 'Choose Payment Coin' : step === 'pay' ? `Pay with ${selected.name}` : step === 'confirm' ? 'Confirm Payment' : 'Payment Submitted'}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5">

          {/* STEP 1 — Select coin */}
          {step === 'select' && (
            <>
              <p className="text-slate-400 text-sm mb-4">Select your preferred cryptocurrency. All send to Emmanuel King&apos;s verified wallet.</p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {COINS.map(coin => (
                  <button key={coin.id}
                    onClick={() => setSelected(coin)}
                    className="flex items-center gap-2.5 p-3 rounded-xl text-left transition-all"
                    style={{
                      background: selected.id === coin.id ? `${coin.color}18` : '#060810',
                      border: `1px solid ${selected.id === coin.id ? coin.color : G.border}`,
                    }}>
                    <span style={{ fontSize: 18, width: 24, textAlign: 'center', color: coin.color }}>{coin.icon}</span>
                    <div>
                      <div className="text-white text-xs font-bold">{coin.symbol}</div>
                      <div className="text-slate-500 text-xs">{coin.name}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Amount preview */}
              <div className="rounded-xl p-3 mb-5 flex justify-between items-center"
                style={{ background: `${selected.color}10`, border: `1px solid ${selected.color}30` }}>
                <span className="text-slate-400 text-sm">$19/month equivalent</span>
                <span style={{ color: selected.color, fontFamily: 'monospace', fontWeight: 700 }}>
                  ≈ {selected.amount} {selected.symbol}
                </span>
              </div>

              <button onClick={() => setStep('pay')}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all"
                style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
                Continue with {selected.symbol} →
              </button>
            </>
          )}

          {/* STEP 2 — Show address & QR */}
          {step === 'pay' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-xl p-3 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${selected.address}`}
                    alt={`${selected.symbol} QR`}
                    width={150} height={150}
                    className="rounded-lg"
                  />
                </div>
              </div>

              <div className="rounded-xl p-3 mb-3 flex items-center gap-3" style={{ background: '#060810', border: `1px solid ${G.border}` }}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#8a9ab0', wordBreak: 'break-all', flex: 1 }}>
                  {selected.address}
                </span>
                <button onClick={() => copy(selected.address)}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-bold transition-all"
                  style={{ background: copied ? 'rgba(0,229,160,0.15)' : `${selected.color}20`, color: copied ? '#00e5a0' : selected.color }}>
                  {copied ? '✓' : 'Copy'}
                </button>
              </div>

              <div className="rounded-xl p-3 mb-4 flex justify-between items-center"
                style={{ background: `${selected.color}10`, border: `1px solid ${selected.color}30` }}>
                <span className="text-slate-400 text-sm">Send exactly</span>
                <span style={{ color: selected.color, fontFamily: 'monospace', fontWeight: 700 }}>
                  {selected.amount} {selected.symbol}
                </span>
              </div>

              <button onClick={() => setStep('confirm')}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all mb-3"
                style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
                I&apos;ve Sent the Payment →
              </button>
              <button onClick={() => setStep('select')} className="w-full text-slate-500 text-sm hover:text-slate-300 transition-colors">
                ← Change coin
              </button>
            </>
          )}

          {/* STEP 3 — Submit TX */}
          {step === 'confirm' && (
            <>
              <p className="text-slate-300 text-sm mb-4">
                Enter your transaction ID and email. We&apos;ll verify on-chain and send your Sovereign API key within 30 minutes.
              </p>
              <div className="mb-3">
                <label className="text-xs text-slate-500 mb-1.5 block" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                  TRANSACTION ID (TXID / HASH)
                </label>
                <input value={txId} onChange={e => setTxId(e.target.value)}
                  placeholder="Paste your transaction hash..."
                  className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none"
                  style={{ background: '#060810', border: `1px solid ${G.border}`, fontFamily: 'monospace' }} />
              </div>
              <div className="mb-5">
                <label className="text-xs text-slate-500 mb-1.5 block" style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                  YOUR EMAIL
                </label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none"
                  style={{ background: '#060810', border: `1px solid ${G.border}` }} />
              </div>
              <button onClick={submit} disabled={!txId.trim() || !email.trim() || submitting}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all mb-3 disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
                {submitting ? 'Verifying on-chain...' : 'Submit Payment Proof →'}
              </button>
              <button onClick={() => setStep('pay')} className="w-full text-slate-500 text-sm hover:text-slate-300 transition-colors">
                ← Back
              </button>
            </>
          )}

          {/* STEP 4 — Done */}
          {step === 'done' && (
            <div className="text-center py-6">
              <div className="text-4xl mb-4">{verifyResult?.status === 'verified' ? '✅' : '⚖️'}</div>
              <h3 className="text-white font-bold text-lg mb-2">
                {verifyResult?.status === 'verified' ? 'Payment Verified!' : 'Payment Submitted'}
              </h3>
              {verifyResult?.status === 'verified' ? (
                <p className="text-slate-400 text-sm mb-6">
                  Your payment was confirmed on-chain. Your Sovereign API key has been generated and will be sent to{' '}
                  <span style={{ color: G.gold }}>{email}</span> shortly.
                </p>
              ) : (
                <>
                  <p className="text-slate-400 text-sm mb-1">
                    Verifying your {selected.symbol} transaction on-chain.
                  </p>
                  <p className="text-slate-400 text-sm mb-6">
                    Your Sovereign API key will be sent to <span style={{ color: G.gold }}>{email}</span> within 30 minutes.
                  </p>
                </>
              )}
              <button onClick={onClose}
                className="px-6 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
                Close
              </button>
            </div>
          )}

        </div>

        {/* Footer */}
        {step !== 'done' && (
          <div style={{ borderTop: `1px solid ${G.border}`, padding: '10px 20px' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#4a5870', textAlign: 'center', letterSpacing: '0.1em' }}>
              10 COINS ACCEPTED · VERIFIED WALLET · BLOCKCHAIN CONFIRMED
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
