'use client';

import { useState, useRef, useEffect } from 'react';

type StepType = 'thought' | 'tool_call' | 'tool_result' | 'answer' | 'error';
interface Step { type: StepType; content: string; tool?: string; model?: string; }
type Model = 'claude' | 'groq-70b' | 'groq-8b' | 'gemini-flash';

const MODEL_LABELS: Record<Model, { label: string; sub: string; color: string }> = {
  'claude':        { label: 'Claude',       sub: 'Sonnet 4 — best',      color: '#f59e0b' },
  'groq-70b':      { label: 'Groq 70B',     sub: 'fast · free',          color: '#3b82f6' },
  'groq-8b':       { label: 'Groq 8B',      sub: 'fastest · free',       color: '#60a5fa' },
  'gemini-flash':  { label: 'Gemini Flash', sub: '1M context · free',    color: '#22c55e' },
};

const STEP_STYLE: Record<StepType, { border: string; label: string; color: string }> = {
  thought:     { border: '#334155', label: 'thinking',    color: '#94a3b8' },
  tool_call:   { border: '#3b82f6', label: 'tool call',   color: '#60a5fa' },
  tool_result: { border: '#22c55e', label: 'result',      color: '#86efac' },
  answer:      { border: '#f59e0b', label: 'answer',      color: '#fcd34d' },
  error:       { border: '#ef4444', label: 'error',       color: '#fca5a5' },
};

const EXAMPLE_TASKS = [
  'What is the current constitutional health of the system?',
  'Show me the last 5 audit receipts',
  'Read the generator.ts agent and summarise its constitutional role',
  'Check the latest build status',
  'What is the M score across recent sessions?',
];

export default function AgentPage() {
  const [task,    setTask]    = useState('');
  const [model,   setModel]   = useState<Model>('claude');
  const [steps,   setSteps]   = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [turns,   setTurns]   = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [steps]);

  async function run(taskOverride?: string) {
    const t = taskOverride ?? task;
    if (!t.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setTurns(0);

    try {
      const res = await fetch('/api/agent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task: t, model, stream: true }),
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
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ color: '#f59e0b', fontSize: 9, letterSpacing: 3, marginBottom: 2 }}>LEX AUREON · PRAXIS v2.0</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#f1f5f9' }}>CRS Agent</div>
          <div style={{ color: '#475569', fontSize: 10 }}>lives in the codebase · constitutional memory</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.entries(MODEL_LABELS) as [Model, typeof MODEL_LABELS[Model]][]).map(([m, info]) => (
            <button key={m} onClick={() => setModel(m)} style={{
              background: model === m ? '#0f172a' : 'transparent',
              border:     `1px solid ${model === m ? info.color : '#1e293b'}`,
              color:      model === m ? info.color : '#475569',
              padding:    '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 10,
              transition: 'all 0.15s',
            }}>
              <div style={{ fontWeight: 600 }}>{info.label}</div>
              <div style={{ fontSize: 9, opacity: 0.7 }}>{info.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {steps.length === 0 && !running && (
          <div style={{ maxWidth: 560, margin: '40px auto' }}>
            <div style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚖️</div>
              <div style={{ color: '#475569' }}>Ask Lex CRS Agent anything about the Lexaureon system.</div>
              <div style={{ color: '#334155', marginTop: 4, fontSize: 11 }}>Reads your codebase · queries Turso · checks builds · runs governance</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EXAMPLE_TASKS.map(t => (
                <button key={t} onClick={() => { setTask(t); run(t); }} style={{
                  background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
                  color: '#64748b', padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                  textAlign: 'left', transition: 'border-color 0.15s',
                }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {steps.map((step, i) => {
          const s = STEP_STYLE[step.type] ?? STEP_STYLE.thought;
          return (
            <div key={i} style={{ marginBottom: 10, borderLeft: `2px solid ${s.border}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 10, color: s.color, marginBottom: 3, display: 'flex', gap: 8 }}>
                <span>{s.label}</span>
                {step.tool  && <span style={{ color: '#60a5fa' }}>{step.tool}</span>}
                {step.model && <span style={{ color: '#334155' }}>{step.model}</span>}
              </div>
              <pre style={{ margin: 0, fontSize: 12, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
                {step.content.length > 2000 ? step.content.slice(0, 2000) + '\n…' : step.content}
              </pre>
            </div>
          );
        })}

        {running && (
          <div style={{ borderLeft: '2px solid #1e293b', paddingLeft: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#334155' }}>
              {MODEL_LABELS[model].label} · turn {turns}
            </div>
            <div style={{ color: '#1e293b', fontSize: 14, marginTop: 4 }}>● ● ●</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid #1e293b', display: 'flex', gap: 8 }}>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder="Give the agent a task…  (Enter to run)"
          style={{
            flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
            color: '#f1f5f9', padding: '10px 14px', fontSize: 13, fontFamily: 'monospace',
            resize: 'none', height: 58, outline: 'none', lineHeight: 1.5,
          }}
          disabled={running}
        />
        <button onClick={() => run()} disabled={running || !task.trim()} style={{
          background:  running ? '#0f172a' : '#f59e0b',
          color:       running ? '#334155' : '#0a0f1a',
          border:      `1px solid ${running ? '#1e293b' : '#f59e0b'}`,
          borderRadius: 8, padding: '0 18px', fontWeight: 700,
          fontSize: 13, cursor: running ? 'default' : 'pointer', fontFamily: 'monospace',
          minWidth: 70,
        }}>
          {running ? '…' : 'run ⚡'}
        </button>
      </div>
    </div>
  );
}
