'use client';

import { useState, useRef, useEffect } from 'react';

type StepType = 'thought' | 'tool_call' | 'tool_result' | 'answer' | 'error';
interface Step { type: StepType; content: string; tool?: string; model?: string; }
type Model = 'groq-70b' | 'groq-8b' | 'gemini-flash';

const MODEL_LABELS: Record<Model, string> = {
  'groq-70b':     'Groq 70B — primary',
  'groq-8b':      'Groq 8B — fast',
  'gemini-flash': 'Gemini Flash — large context',
};

const STEP_STYLE: Record<StepType, { border: string; label: string; labelColor: string }> = {
  thought:     { border: '#334155', label: 'thinking',    labelColor: '#94a3b8' },
  tool_call:   { border: '#3b82f6', label: 'tool call',   labelColor: '#60a5fa' },
  tool_result: { border: '#22c55e', label: 'tool result', labelColor: '#86efac' },
  answer:      { border: '#f59e0b', label: 'answer',      labelColor: '#fcd34d' },
  error:       { border: '#ef4444', label: 'error',       labelColor: '#fca5a5' },
};

export default function AgentPage() {
  const [task,    setTask]    = useState('');
  const [model,   setModel]   = useState<Model>('groq-70b');
  const [steps,   setSteps]   = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [turns,   setTurns]   = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [steps]);

  async function run() {
    if (!task.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setTurns(0);

    try {
      const res = await fetch('/api/agent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task, model, stream: true }),
      });

      if (!res.body) throw new Error('No response body');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const step = JSON.parse(raw) as Step;
            setSteps(prev => [...prev, step]);
            if (step.type === 'tool_call') setTurns(t => t + 1);
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setSteps(prev => [...prev, { type: 'error', content: String(e) }]);
    }
    setRunning(false);
  }

  return (
    <div style={{ background: '#0a0f1a', minHeight: '100vh', fontFamily: 'monospace', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#f59e0b', fontSize: 10, letterSpacing: 3 }}>LEX AUREON</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>CRS Agent</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>AI coding agent · lives in the codebase</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(['groq-70b', 'groq-8b', 'gemini-flash'] as Model[]).map(m => (
            <button key={m} onClick={() => setModel(m)} style={{
              background: model === m ? '#1e3a5f' : 'transparent',
              border:     `1px solid ${model === m ? '#3b82f6' : '#334155'}`,
              color:      model === m ? '#93c5fd' : '#64748b',
              padding:    '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 10,
            }}>{m}</button>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {steps.length === 0 && !running && (
          <div style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 60 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚖️</div>
            <div>Ask Lex CRS Agent anything about the codebase.</div>
            <div style={{ marginTop: 8, color: '#1e293b' }}>
              "Fix the build error in route.ts" · "Show me the latest receipts" · "What is the current M score?"
            </div>
          </div>
        )}

        {steps.map((step, i) => {
          const s = STEP_STYLE[step.type] ?? STEP_STYLE.thought;
          return (
            <div key={i} style={{ marginBottom: 10, borderLeft: `2px solid ${s.border}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 10, color: s.labelColor, marginBottom: 3, display: 'flex', gap: 8 }}>
                <span>{s.label}</span>
                {step.tool  && <span style={{ color: '#60a5fa' }}>{step.tool}</span>}
                {step.model && <span style={{ color: '#475569' }}>{step.model}</span>}
              </div>
              <pre style={{ margin: 0, fontSize: 12, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {step.content.length > 2000 ? step.content.slice(0, 2000) + '\n…' : step.content}
              </pre>
            </div>
          );
        })}

        {running && (
          <div style={{ borderLeft: '2px solid #334155', paddingLeft: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#475569' }}>thinking · {MODEL_LABELS[model]} · turn {turns}</div>
            <div style={{ color: '#334155', fontSize: 12, animation: 'pulse 1s infinite' }}>●●●</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid #1e293b', display: 'flex', gap: 10 }}>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder="Give Lex CRS Agent a task…"
          style={{
            flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
            color: '#f1f5f9', padding: '10px 14px', fontSize: 13, fontFamily: 'monospace',
            resize: 'none', height: 60, outline: 'none',
          }}
          disabled={running}
        />
        <button
          onClick={run}
          disabled={running || !task.trim()}
          style={{
            background:    running ? '#1e293b' : '#f59e0b',
            color:         running ? '#475569' : '#0a0f1a',
            border:        'none', borderRadius: 8, padding: '0 20px',
            fontWeight:    700, fontSize: 13, cursor: running ? 'default' : 'pointer',
            fontFamily:    'monospace',
          }}
        >
          {running ? 'running…' : 'run ⚡'}
        </button>
      </div>
    </div>
  );
}
