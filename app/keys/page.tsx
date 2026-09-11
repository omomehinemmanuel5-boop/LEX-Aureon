'use client';

import { useState } from 'react';
import Link from 'next/link';

interface KeyRecord {
  id: string;
  name: string;
  key_preview: string;
  plan: string;
  runs_used: number;
  runs_limit: number;
  created_at: number;
  last_used_at: number | null;
}

export default function KeysPage() {
  const [email, setEmail]     = useState('');
  const [name, setName]       = useState('');
  const [keys, setKeys]       = useState<KeyRecord[]>([]);
  const [newKey, setNewKey]   = useState('');
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  const generate = async () => {
    if (!email.includes('@')) { setError('Enter a valid email'); return; }
    setLoading(true); setError(''); setNewKey('');
    try {
      const r = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || 'My Key' }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      setNewKey(d.key);
      await fetchKeys();
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const fetchKeys = async () => {
    if (!email.includes('@')) { setError('Enter a valid email'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/keys?email=${encodeURIComponent(email)}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      setKeys(d.keys); setFetched(true);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? This cannot be undone.')) return;
    const r = await fetch('/api/keys/revoke', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email }),
    });
    if (r.ok) setKeys(keys.filter(k => k.id !== id));
  };

  const copy = () => {
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main style={{ minHeight:'100vh', background:'#07070d', color:'#e8e8e8', fontFamily:'monospace', padding:'2rem 1rem' }}>
      <div style={{ maxWidth:640, margin:'0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom:'2rem' }}>
          <Link href="/" style={{ color:'#c9a84c', textDecoration:'none', fontSize:13 }}>← Back to Lex Aureon</Link>
          <h1 style={{ color:'#e8c96d', fontSize:24, margin:'1rem 0 0.25rem' }}>API Keys</h1>
          <p style={{ color:'#6b7280', fontSize:13, margin:0 }}>
            Integrate PRAXIS constitutional governance into your own systems.
          </p>
        </div>

        {/* Usage example */}
        <div style={{ background:'#0d0d1a', border:'1px solid #1f2937', borderRadius:8, padding:'1rem', marginBottom:'1.5rem' }}>
          <p style={{ color:'#c9a84c', fontSize:11, margin:'0 0 0.5rem', textTransform:'uppercase', letterSpacing:1 }}>Quick Start</p>
          <pre style={{ color:'#10b981', fontSize:11, margin:0, overflowX:'auto', whiteSpace:'pre-wrap' }}>{`curl -X POST https://www.lexaureon.com/api/lex/run \\
  -H "x-api-key: lex_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Your prompt here"}'`}</pre>
        </div>

        {/* Input */}
        <div style={{ background:'#0d0d1a', border:'1px solid #1f2937', borderRadius:8, padding:'1.25rem', marginBottom:'1rem' }}>
          <div style={{ marginBottom:'0.75rem' }}>
            <label style={{ color:'#9ca3af', fontSize:12, display:'block', marginBottom:4 }}>EMAIL</label>
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width:'100%', background:'#07070d', border:'1px solid #374151', borderRadius:6, padding:'0.6rem 0.75rem', color:'#e8e8e8', fontSize:14, boxSizing:'border-box' }}
            />
          </div>
          <div style={{ marginBottom:'1rem' }}>
            <label style={{ color:'#9ca3af', fontSize:12, display:'block', marginBottom:4 }}>KEY NAME (optional)</label>
            <input
              type="text" value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Production, Research, etc."
              style={{ width:'100%', background:'#07070d', border:'1px solid #374151', borderRadius:6, padding:'0.6rem 0.75rem', color:'#e8e8e8', fontSize:14, boxSizing:'border-box' }}
            />
          </div>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <button onClick={generate} disabled={loading}
              style={{ flex:1, background:'#c9a84c', color:'#07070d', border:'none', borderRadius:6, padding:'0.7rem', fontWeight:700, fontSize:14, cursor:'pointer' }}>
              {loading ? 'Generating...' : '⚡ Generate Key'}
            </button>
            <button onClick={fetchKeys} disabled={loading}
              style={{ padding:'0.7rem 1rem', background:'transparent', color:'#c9a84c', border:'1px solid #c9a84c', borderRadius:6, fontSize:13, cursor:'pointer' }}>
              View Keys
            </button>
          </div>
        </div>

        {error && <p style={{ color:'#ef4444', fontSize:13, margin:'0.5rem 0' }}>{error}</p>}

        {/* New key display */}
        {newKey && (
          <div style={{ background:'#052e16', border:'1px solid #16a34a', borderRadius:8, padding:'1rem', marginBottom:'1rem' }}>
            <p style={{ color:'#16a34a', fontSize:12, margin:'0 0 0.5rem', fontWeight:700 }}>
              ✓ KEY GENERATED — Copy it now. It will not be shown again.
            </p>
            <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
              <code style={{ flex:1, color:'#4ade80', fontSize:12, wordBreak:'break-all', background:'#071a0f', padding:'0.5rem', borderRadius:4 }}>
                {newKey}
              </code>
              <button onClick={copy}
                style={{ padding:'0.5rem 0.75rem', background: copied ? '#16a34a' : '#374151', color:'#fff', border:'none', borderRadius:6, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p style={{ color:'#6b7280', fontSize:11, margin:'0.5rem 0 0' }}>
              Free tier: 1,000 governance runs · Upgrade for more
            </p>
          </div>
        )}

        {/* Keys list */}
        {fetched && keys.length === 0 && (
          <p style={{ color:'#6b7280', fontSize:13, textAlign:'center', padding:'2rem' }}>No keys found for this email.</p>
        )}

        {keys.map(k => (
          <div key={k.id} style={{ background:'#0d0d1a', border:'1px solid #1f2937', borderRadius:8, padding:'1rem', marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <p style={{ color:'#e8c96d', fontSize:14, fontWeight:700, margin:'0 0 0.25rem' }}>{k.name}</p>
                <code style={{ color:'#6b7280', fontSize:12 }}>{k.key_preview}</code>
              </div>
              <span style={{ background: k.plan === 'sovereign' ? '#c9a84c22' : '#1f2937', color: k.plan === 'sovereign' ? '#c9a84c' : '#9ca3af', fontSize:11, padding:'2px 8px', borderRadius:4, textTransform:'uppercase' }}>
                {k.plan}
              </span>
            </div>
            <div style={{ marginTop:'0.75rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ background:'#1f2937', borderRadius:4, height:4, width:180, marginBottom:4 }}>
                  <div style={{ background: k.runs_used/k.runs_limit > 0.8 ? '#ef4444' : '#c9a84c', borderRadius:4, height:4, width:`${Math.min(100,(k.runs_used/k.runs_limit)*100)}%` }} />
                </div>
                <p style={{ color:'#6b7280', fontSize:11, margin:0 }}>
                  {k.runs_used} / {k.runs_limit} runs
                  {k.last_used_at ? ` · Last used ${new Date(k.last_used_at*1000).toLocaleDateString()}` : ' · Never used'}
                </p>
              </div>
              <button onClick={() => revoke(k.id)}
                style={{ background:'transparent', color:'#ef4444', border:'1px solid #ef444433', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer' }}>
                Revoke
              </button>
            </div>
          </div>
        ))}

        {/* Plans */}
        <div style={{ marginTop:'2rem', background:'#0d0d1a', border:'1px solid #c9a84c33', borderRadius:8, padding:'1.25rem' }}>
          <p style={{ color:'#c9a84c', fontSize:13, fontWeight:700, margin:'0 0 0.75rem' }}>Plans</p>
          <div style={{ display:'flex', gap:'0.75rem' }}>
            <div style={{ flex:1, background:'#07070d', borderRadius:6, padding:'0.75rem' }}>
              <p style={{ color:'#e8e8e8', fontSize:13, fontWeight:700, margin:'0 0 0.25rem' }}>Free</p>
              <p style={{ color:'#c9a84c', fontSize:18, fontWeight:700, margin:'0 0 0.25rem' }}>$0</p>
              <p style={{ color:'#6b7280', fontSize:11, margin:0 }}>1,000 runs/key · 3 keys max</p>
            </div>
            <div style={{ flex:1, background:'#07070d', border:'1px solid #c9a84c', borderRadius:6, padding:'0.75rem' }}>
              <p style={{ color:'#e8c96d', fontSize:13, fontWeight:700, margin:'0 0 0.25rem' }}>Sovereign</p>
              <p style={{ color:'#c9a84c', fontSize:18, fontWeight:700, margin:'0 0 0.25rem' }}>$19/mo</p>
              <p style={{ color:'#6b7280', fontSize:11, margin:0 }}>10,000 runs · Unlimited keys</p>
              <a href="mailto:lexaureon@gmail.com?subject=Sovereign Plan" style={{ color:'#c9a84c', fontSize:11, display:'block', marginTop:4 }}>Upgrade →</a>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
