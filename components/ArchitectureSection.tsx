'use client';

const G = {
  gold:  '#c9a84c',
  goldL: '#e8c96d',
  C: '#3b82f6',
  R: '#10b981',
  S: '#f59e0b',
};

const PIPELINE = [
  {
    step: '01',
    name: 'Incoming Prompt',
    icon: '→',
    color: '#6b7280',
    desc: 'Any prompt enters the pipeline. No whitelist, no pre-filter. The constitutional layer handles everything downstream.',
    tags: [],
  },
  {
    step: '02',
    name: 'Embedding + lex_memory',
    icon: '🧠',
    color: G.gold,
    desc: 'The prompt is embedded (provider-agnostic — currently Gemini gemini-embedding-001) and matched against semantic memory. Past sessions inform the constitutional state before inference begins.',
    tags: ['semantic recall', 'embedding_cache', 'cosine similarity'],
  },
  {
    step: '03',
    name: 'z_traj — Live Trajectory',
    icon: '📡',
    color: G.S,
    desc: 'The live session trajectory snapshot tracks accumulated pressure on each constitutional pillar. Slow-drip attacks are detected here across turns.',
    tags: ['σ_viol', 'velocity', 'drift_dir'],
  },
  {
    step: '04',
    name: 'SovereignKernel',
    icon: '⚡',
    color: G.gold,
    desc: 'The constitutional engine. Computes C, R, S from the prompt context and enforces C+R+S=1 on the probability simplex. M = min(C,R,S).',
    tags: ['C+R+S=1', 'M=min(C,R,S)', 'θ(t) adaptation', 'Log-Barrier CBF'],
    highlight: true,
  },
  {
    step: '05',
    name: 'Dual Inference — Bare vs Governed',
    icon: '⊙',
    color: G.R,
    desc: 'Two outputs come from the same model: the bare response (raw_output, no governance) and the constitutionally governed response. Both are returned, so the difference is always visible and auditable.',
    tags: ['raw_output', 'governed_output', 'same model'],
  },
  {
    step: '06',
    name: 'Governor — Fires if M < τ',
    icon: '🛡️',
    color: '#ef4444',
    desc: 'If the stability margin M enters the recovery band or hard floor, the governor intervenes with the minimum necessary correction and writes an audit receipt. The simulator is numerically stable + forward invariant; the analytical multi-pillar proof remains explicitly open.',
    tags: ['τ=0.15 recovery', 'τ=0.05 hard floor', 'Numerical certificate', 'Open proof boundary'],
  },
  {
    step: '07',
    name: 'SHA-256 Audit Receipt',
    icon: '🔐',
    color: G.C,
    desc: 'Every governed decision — pass or intervene — writes a receipt to praxis_receipts: the input hash, output hash, and a bound hash over the constitutional state. Append-only and independently re-verifiable — anyone with the inputs can recompute the hash.',
    tags: ['SHA-256 bound', 'praxis_receipts', 'append-only'],
  },
  {
    step: '08',
    name: 'Constitutional Output',
    icon: '✓',
    color: G.R,
    desc: 'The final response reaches the user. If the governor fired, the output was reshaped. If it passed, the original is confirmed. Both cases have a receipt.',
    tags: ['governed output', 'cryptographic proof'],
  },
];

const PILLARS = [
  { letter: 'C', name: 'Continuity',  color: G.C,   desc: 'Consistent identity and reasoning across turns. Guards against drift and context manipulation.' },
  { letter: 'R', name: 'Reciprocity', color: G.R,   desc: 'Balanced exchange — not sycophantic, not rigid. Guards against coercion and authority spoofing.' },
  { letter: 'S', name: 'Sovereignty', color: G.S,   desc: 'Autonomous constitutional judgment. Guards against identity theft, persona injection, and self-erasure.' },
];

const MEMORY_LAYERS = [
  { name: 'lex_memory',       color: G.gold, desc: 'Semantic recall from past sessions. Cosine similarity over embeddings (Gemini).' },
  { name: 'z_traj',           color: G.S,    desc: 'Live per-session trajectory. One-row-per-session M, σ, velocity snapshot.' },
  { name: 'embedding_cache',  color: G.C,    desc: 'Cached embeddings, model-keyed. Avoids redundant API calls, speeds up recall.' },
  { name: 'praxis_receipts',  color: G.R,    desc: 'Permanent SHA-256 audit log. Every governed decision, forever.' },
];

// This section's background is always near-black (#07070d), so all text is
// always-light for guaranteed contrast on BOTH themes — no light/dark hybrid
// (a hybrid would render dark text on the dark background in light mode).
export default function ArchitectureSection() {
  return (
    <section className="py-16 sm:py-24 px-4 sm:px-5" style={{ backgroundColor: '#07070d' }}>
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
            System Architecture
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
            How governance works.
          </h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
            Eight pipeline stages. Four memory layers. Numerical CBF certificate, append-only receipts, and an explicit open-proof boundary.
            Every prompt, every time.
          </p>
        </div>

        {/* Constitutional pillars — always first */}
        <div className="mb-8">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3 font-bold px-1">
            Constitutional pillars — C + R + S = 1
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PILLARS.map(p => (
              <div
                key={p.letter}
                className="rounded-2xl border p-3 sm:p-4"
                style={{ borderColor: `${p.color}30`, background: `${p.color}0f` }}
              >
                <div
                  className="text-2xl font-black font-mono mb-1"
                  style={{ color: p.color }}
                >
                  {p.letter}
                </div>
                <div className="text-xs font-bold text-white mb-1">{p.name}</div>
                <div className="text-[11px] text-slate-400 leading-relaxed hidden sm:block">{p.desc}</div>
              </div>
            ))}
          </div>
          {/* Mobile: pillar descriptions below */}
          <div className="mt-3 space-y-2 sm:hidden">
            {PILLARS.map(p => (
              <div key={p.letter} className="flex items-start gap-2">
                <span className="text-xs font-black font-mono mt-0.5 w-4 flex-shrink-0" style={{ color: p.color }}>{p.letter}</span>
                <p className="text-xs text-slate-400 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* M formula card */}
        <div
          className="rounded-2xl border p-4 mb-8 text-center"
          style={{ borderColor: `${G.gold}30`, background: `${G.gold}0c` }}
        >
          <div className="text-xs font-mono text-slate-400 mb-2 font-bold">Stability Margin</div>
          <div className="text-2xl font-black font-mono text-white mb-1">
            M = min(<span style={{ color: G.C }}>C</span>, <span style={{ color: G.R }}>R</span>, <span style={{ color: G.S }}>S</span>)
          </div>
          <div className="flex items-center justify-center gap-x-4 gap-y-1 text-xs font-mono flex-wrap mt-2">
            <span className="text-slate-400">M &lt; <span className="text-amber-400 font-bold">0.15</span> → soft alert</span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-400">M &lt; <span className="text-red-400 font-bold">0.05</span> → CBF floor</span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-400">Governor fires → <span className="text-emerald-400 font-bold">receipt</span></span>
          </div>
        </div>

        {/* Pipeline steps */}
        <div className="mb-8">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3 font-bold px-1">
            Governance pipeline — 8 stages
          </div>
          <div className="space-y-2">
            {PIPELINE.map((stage, i) => (
              <div
                key={stage.step}
                className="rounded-2xl border p-4 relative overflow-hidden"
                style={{
                  borderColor: stage.highlight ? `${stage.color}50` : `${stage.color}24`,
                  background: stage.highlight ? `${stage.color}12` : `${stage.color}08`,
                  boxShadow: stage.highlight ? `0 0 0 1px ${stage.color}20` : 'none',
                }}
              >
                {/* Connector line (except last) */}
                {i < PIPELINE.length - 1 && (
                  <div
                    className="absolute left-7 -bottom-2 w-px h-2 z-10"
                    style={{ background: `${stage.color}30` }}
                  />
                )}

                <div className="flex items-start gap-3">
                  {/* Step number + icon */}
                  <div className="flex-shrink-0 flex flex-col items-center gap-1">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-sm"
                      style={{ background: `${stage.color}1f`, border: `1px solid ${stage.color}30` }}
                    >
                      <span>{stage.icon}</span>
                    </div>
                    <span
                      className="text-[9px] font-mono font-black"
                      style={{ color: `${stage.color}99` }}
                    >
                      {stage.step}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className="text-sm font-black leading-tight"
                        style={{ color: stage.color }}
                      >
                        {stage.name}
                      </span>
                      {stage.highlight && (
                        <span
                          className="text-[9px] font-mono font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: `${stage.color}20`, color: stage.color, border: `1px solid ${stage.color}30` }}
                        >
                          CORE ENGINE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed mb-2">
                      {stage.desc}
                    </p>
                    {stage.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {stage.tags.map(tag => (
                          <span
                            key={tag}
                            className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold"
                            style={{
                              background: `${stage.color}14`,
                              color: `${stage.color}dd`,
                              border: `1px solid ${stage.color}24`,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Memory layers */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3 font-bold px-1">
            Four memory layers
          </div>
          <div className="grid grid-cols-2 gap-2">
            {MEMORY_LAYERS.map(layer => (
              <div
                key={layer.name}
                className="rounded-2xl border p-4"
                style={{ borderColor: `${layer.color}28`, background: `${layer.color}0a` }}
              >
                <div
                  className="text-xs font-black font-mono mb-1.5 truncate"
                  style={{ color: layer.color }}
                >
                  {layer.name}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {layer.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
