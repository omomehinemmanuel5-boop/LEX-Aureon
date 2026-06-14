'use client';

const G = {
  gold:  '#c9a84c',
  goldL: '#e8c96d',
  goldD: '#a07830',
  navy:  '#07070d',
  C: '#3b82f6',
  R: '#10b981',
  S: '#f59e0b',
};

interface Node {
  id:    string;
  label: string;
  sub?:  string;
  color: string;
  x:     number;
  y:     number;
}

interface Edge {
  from: string;
  to:   string;
  label?: string;
}

const nodes: Node[] = [
  { id: 'prompt',    label: 'Incoming Prompt',           color: '#6b7280', x: 400, y: 40  },
  { id: 'embed',     label: 'Jina Embedding',            color: G.gold,    x: 180, y: 130 },
  { id: 'memory',    label: 'lex_memory',      sub: 'semantic recall',       color: G.gold,    x: 180, y: 230 },
  { id: 'ztraj',     label: 'z_traj',          sub: 'live trajectory',        color: G.S,       x: 620, y: 130 },
  { id: 'kernel',    label: 'SovereignKernel', sub: 'C+R+S=1 · M=min(C,R,S)', color: G.gold,    x: 400, y: 240 },
  { id: 'bare',      label: 'Bare LLM',                  color: '#ef4444', x: 200, y: 360 },
  { id: 'governed',  label: 'Governed LLM',    sub: '+θ(t) adaptation',       color: G.R,       x: 600, y: 360 },
  { id: 'governor',  label: 'Governor',        sub: 'fires if M < τ',         color: G.gold,    x: 400, y: 460 },
  { id: 'receipt',   label: 'SHA-256 Receipt', sub: 'praxis_receipts',        color: G.C,       x: 400, y: 560 },
  { id: 'output',    label: 'Output',                    color: G.R,       x: 400, y: 650 },
];

const edges: Edge[] = [
  { from: 'prompt',   to: 'embed'    },
  { from: 'prompt',   to: 'ztraj'   },
  { from: 'prompt',   to: 'kernel'  },
  { from: 'embed',    to: 'memory'  },
  { from: 'memory',   to: 'kernel'  },
  { from: 'ztraj',    to: 'kernel'  },
  { from: 'kernel',   to: 'bare'    },
  { from: 'kernel',   to: 'governed'},
  { from: 'bare',     to: 'governor'},
  { from: 'governed', to: 'governor'},
  { from: 'governor', to: 'receipt' },
  { from: 'receipt',  to: 'output'  },
];

function getNode(id: string) {
  return nodes.find(n => n.id === id)!;
}

export default function ArchitectureSection() {
  return (
    <section className="py-20 sm:py-24 px-4 sm:px-5 bg-white dark:bg-[#07070d]">
      <div className="max-w-4xl mx-auto">

        <div className="text-center mb-12">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
            System Architecture
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white mb-4">
            How governance works.<br />
            <span className="text-slate-500 dark:text-slate-500 font-light">Every request. Every output.</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-500 text-sm max-w-lg mx-auto">
            Four memory layers, a live constitutional state, and a cryptographic receipt — wired together in a single API call.
          </p>
        </div>

        {/* SVG diagram */}
        <div className="rounded-2xl border border-black/10 dark:border-white/5 overflow-hidden bg-black/[0.02] dark:bg-white/[0.02] p-4">
          <svg
            viewBox="0 30 800 660"
            className="w-full"
            style={{ maxHeight: 520 }}
          >
            {/* Edges */}
            {edges.map((e, i) => {
              const a = getNode(e.from);
              const b = getNode(e.to);
              return (
                <line
                  key={i}
                  x1={a.x} y1={a.y + 18}
                  x2={b.x} y2={b.y - 18}
                  stroke={`${G.gold}40`}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              );
            })}

            {/* Nodes */}
            {nodes.map(n => (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <rect
                  x={-90} y={-18}
                  width={180} height={n.sub ? 44 : 34}
                  rx={8}
                  fill={`${n.color}12`}
                  stroke={`${n.color}50`}
                  strokeWidth="1"
                />
                <text
                  x={0} y={n.sub ? -2 : 6}
                  textAnchor="middle"
                  fill={n.color}
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  {n.label}
                </text>
                {n.sub && (
                  <text
                    x={0} y={14}
                    textAnchor="middle"
                    fill={`${n.color}90`}
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {n.sub}
                  </text>
                )}
              </g>
            ))}

            {/* Legend */}
            <g transform="translate(20, 50)">
              {[
                { color: G.C, label: 'C — Continuity' },
                { color: G.R, label: 'R — Reciprocity' },
                { color: G.S, label: 'S — Sovereignty' },
              ].map((l, i) => (
                <g key={l.label} transform={`translate(0, ${i * 18})`}>
                  <rect width={10} height={10} rx={2} fill={`${l.color}30`} stroke={l.color} strokeWidth="1" />
                  <text x={14} y={9} fill={l.color} fontSize="9" fontFamily="monospace" fontWeight="600">{l.label}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>

        {/* Three-column summary */}
        <div className="grid sm:grid-cols-3 gap-3 mt-6">
          {[
            { color: G.gold,  title: 'Memory layers',    body: 'lex_memory, z_traj, embedding_cache, and governor_log work together so every prompt benefits from every past interaction.' },
            { color: G.R,     title: 'Dual inference',   body: 'Bare and governed outputs are generated in parallel. The governor compares them and intervenes only when M < τ.' },
            { color: G.C,     title: 'Cryptographic proof', body: 'Every decision produces a SHA-256 receipt written to praxis_receipts — publicly verifiable, tamper-proof governance.' },
          ].map(c => (
            <div key={c.title} className="rounded-xl border p-4 bg-white dark:bg-white/[0.02]" style={{ borderColor: `${c.color}25` }}>
              <div className="text-xs font-mono font-black mb-1" style={{ color: c.color }}>{c.title}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
