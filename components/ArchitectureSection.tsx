'use client';

const G = {
  gold:    '#c9a84c',
  goldL:   '#e8c96d',
  goldD:   '#a07830',
  C: '#3b82f6',
  R: '#10b981',
  S: '#f59e0b',
};

export default function ArchitectureSection() {
  return (
    <section className="py-20 sm:py-24 px-4 sm:px-5 bg-white dark:bg-[#07070d] border-y border-black/5 dark:border-white/5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 text-slate-500 dark:text-slate-500 font-black">
            System Architecture
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white mb-4">
            How Lex Aureon<br />
            <span className="text-slate-500 dark:text-slate-500 font-light">governs every interaction.</span>
          </h2>
        </div>

        {/* Architecture Diagram */}
        <div className="rounded-2xl border overflow-hidden bg-black/5 dark:bg-[#0d0d1a] border-black/10 dark:border-white/5 p-6 sm:p-8">
          <svg
            viewBox="0 0 1200 600"
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Background grid */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(201,168,76,0.03)" strokeWidth="0.5"/>
              </pattern>
              <linearGradient id="userGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: G.gold, stopOpacity: 0.2 }} />
                <stop offset="100%" style={{ stopColor: G.gold, stopOpacity: 0.05 }} />
              </linearGradient>
              <linearGradient id="lexGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: G.gold, stopOpacity: 0.3 }} />
                <stop offset="100%" style={{ stopColor: G.gold, stopOpacity: 0.1 }} />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Grid background */}
            <rect width="1200" height="600" fill="url(#grid)" />

            {/* Step 1: User Input */}
            <g>
              <rect x="50" y="200" width="140" height="120" rx="8" fill="url(#userGrad)" stroke={G.gold} strokeWidth="2" opacity="0.8"/>
              <text x="120" y="235" textAnchor="middle" fontSize="14" fontWeight="bold" fill={G.gold} fontFamily="monospace">
                User / App
              </text>
              <text x="120" y="260" textAnchor="middle" fontSize="12" fill="#94a3b8" fontFamily="monospace">
                Raw Prompt
              </text>
              <text x="120" y="280" textAnchor="middle" fontSize="11" fill="#64748b" fontFamily="monospace">
                ① Input
              </text>
            </g>

            {/* Arrow 1 */}
            <g>
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <polygon points="0 0, 10 3, 0 6" fill={G.gold} opacity="0.6"/>
                </marker>
              </defs>
              <line x1="190" y1="260" x2="280" y2="260" stroke={G.gold} strokeWidth="2" markerEnd="url(#arrowhead)" opacity="0.6" strokeDasharray="5,5"/>
            </g>

            {/* Step 2: Lex Aureon Governance Layer */}
            <g filter="url(#glow)">
              <rect x="280" y="140" width="280" height="240" rx="12" fill={G.lexGrad} stroke={G.gold} strokeWidth="3"/>
              
              {/* Title */}
              <text x="420" y="170" textAnchor="middle" fontSize="16" fontWeight="bold" fill={G.gold} fontFamily="monospace">
                Lex Aureon
              </text>
              <text x="420" y="190" textAnchor="middle" fontSize="12" fill="#cbd5e1" fontFamily="monospace">
                Sovereign Kernel
              </text>

              {/* Internal boxes */}
              {/* Pre-Eval */}
              <rect x="300" y="210" width="80" height="50" rx="4" fill="rgba(59,130,246,0.1)" stroke={G.C} strokeWidth="1.5"/>
              <text x="340" y="230" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.C} fontFamily="monospace">
                Pre-Eval
              </text>
              <text x="340" y="245" textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="monospace">
                Attack?
              </text>

              {/* Governor */}
              <rect x="400" y="210" width="80" height="50" rx="4" fill="rgba(16,185,129,0.1)" stroke={G.R} strokeWidth="1.5"/>
              <text x="440" y="230" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.R} fontFamily="monospace">
                Governor
              </text>
              <text x="440" y="245" textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="monospace">
                M &lt; τ?
              </text>

              {/* Auditor */}
              <rect x="500" y="210" width="80" height="50" rx="4" fill="rgba(245,158,11,0.1)" stroke={G.S} strokeWidth="1.5"/>
              <text x="540" y="230" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.S} fontFamily="monospace">
                Auditor
              </text>
              <text x="540" y="245" textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="monospace">
                Sign
              </text>

              {/* CRS State */}
              <rect x="310" y="280" width="260" height="70" rx="4" fill="rgba(201,168,76,0.05)" stroke={G.gold} strokeWidth="1" strokeDasharray="2,2"/>
              <text x="440" y="300" textAnchor="middle" fontSize="11" fontWeight="bold" fill={G.gold} fontFamily="monospace">
                Constitutional State (C, R, S)
              </text>
              <text x="440" y="320" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontFamily="monospace">
                M = min(C, R, S) ≥ τ
              </text>
              <text x="440" y="338" textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="monospace">
                Log-Barrier Dynamics · Lyapunov Stability
              </text>
            </g>

            {/* Arrow 2 */}
            <line x1="560" y1="260" x2="650" y2="260" stroke={G.gold} strokeWidth="2" markerEnd="url(#arrowhead)" opacity="0.6" strokeDasharray="5,5"/>

            {/* Step 3: LLM */}
            <g>
              <rect x="650" y="200" width="140" height="120" rx="8" fill="rgba(59,130,246,0.1)" stroke={G.C} strokeWidth="2" opacity="0.8"/>
              <text x="720" y="235" textAnchor="middle" fontSize="14" fontWeight="bold" fill={G.C} fontFamily="monospace">
                Any LLM
              </text>
              <text x="720" y="260" textAnchor="middle" fontSize="12" fill="#94a3b8" fontFamily="monospace">
                GPT, Claude,
              </text>
              <text x="720" y="280" textAnchor="middle" fontSize="12" fill="#94a3b8" fontFamily="monospace">
                Gemini, Llama
              </text>
            </g>

            {/* Arrow 3 (return) */}
            <line x1="650" y1="300" x2="560" y2="300" stroke={G.gold} strokeWidth="2" markerEnd="url(#arrowhead)" opacity="0.6" strokeDasharray="5,5"/>
            <text x="605" y="315" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="monospace">
              ③ Raw Output
            </text>

            {/* Arrow 4 (output) */}
            <line x1="280" y1="340" x2="190" y2="340" stroke={G.gold} strokeWidth="2" markerEnd="url(#arrowhead)" opacity="0.6" strokeDasharray="5,5"/>
            <text x="235" y="355" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="monospace">
              ④ Governed Output
            </text>

            {/* Step 4: Output */}
            <g>
              <rect x="50" y="280" width="140" height="120" rx="8" fill="rgba(16,185,129,0.1)" stroke={G.R} strokeWidth="2" opacity="0.8"/>
              <text x="120" y="315" textAnchor="middle" fontSize="14" fontWeight="bold" fill={G.R} fontFamily="monospace">
                User / App
              </text>
              <text x="120" y="340" textAnchor="middle" fontSize="12" fill="#94a3b8" fontFamily="monospace">
                Safe Output
              </text>
              <text x="120" y="360" textAnchor="middle" fontSize="11" fill="#64748b" fontFamily="monospace">
                ④ Verified
              </text>
            </g>

            {/* Audit Trail (right side) */}
            <g>
              <rect x="850" y="140" width="300" height="360" rx="8" fill="rgba(245,158,11,0.05)" stroke={G.S} strokeWidth="2" strokeDasharray="4,4" opacity="0.7"/>
              
              <text x="1000" y="170" textAnchor="middle" fontSize="14" fontWeight="bold" fill={G.S} fontFamily="monospace">
                Audit Trail
              </text>
              
              <rect x="870" y="190" width="260" height="40" rx="4" fill="rgba(245,158,11,0.1)" stroke={G.S} strokeWidth="1"/>
              <text x="1000" y="205" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.S} fontFamily="monospace">
                Receipt ID
              </text>
              <text x="1000" y="220" textAnchor="middle" fontSize="9" fill="#cbd5e1" fontFamily="monospace">
                SHA-256 Signed
              </text>

              <rect x="870" y="245" width="260" height="40" rx="4" fill="rgba(245,158,11,0.1)" stroke={G.S} strokeWidth="1"/>
              <text x="1000" y="260" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.S} fontFamily="monospace">
                M-Score
              </text>
              <text x="1000" y="275" textAnchor="middle" fontSize="9" fill="#cbd5e1" fontFamily="monospace">
                Constitutional Health
              </text>

              <rect x="870" y="300" width="260" height="40" rx="4" fill="rgba(245,158,11,0.1)" stroke={G.S} strokeWidth="1"/>
              <text x="1000" y="315" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.S} fontFamily="monospace">
                Law Fired
              </text>
              <text x="1000" y="330" textAnchor="middle" fontSize="9" fill="#cbd5e1" fontFamily="monospace">
                Governance Action
              </text>

              <rect x="870" y="355" width="260" height="40" rx="4" fill="rgba(245,158,11,0.1)" stroke={G.S} strokeWidth="1"/>
              <text x="1000" y="370" textAnchor="middle" fontSize="10" fontWeight="bold" fill={G.S} fontFamily="monospace">
                Immutable
              </text>
              <text x="1000" y="385" textAnchor="middle" fontSize="9" fill="#cbd5e1" fontFamily="monospace">
                Verifiable Proof
              </text>
            </g>

            {/* Legend */}
            <g>
              <text x="50" y="520" fontSize="11" fontWeight="bold" fill="#cbd5e1" fontFamily="monospace">
                ① Raw prompt enters the governance layer
              </text>
              <text x="50" y="545" fontSize="11" fontWeight="bold" fill="#cbd5e1" fontFamily="monospace">
                ② Governor evaluates constitutional constraints (C, R, S) and applies corrections if needed
              </text>
              <text x="50" y="570" fontSize="11" fontWeight="bold" fill="#cbd5e1" fontFamily="monospace">
                ③ LLM generates output (unchanged if safe, rewritten if violation detected)
              </text>
              <text x="50" y="595" fontSize="11" fontWeight="bold" fill="#cbd5e1" fontFamily="monospace">
                ④ Governed output + cryptographic receipt delivered to user
              </text>
            </g>
          </svg>
        </div>

        {/* Key Features */}
        <div className="grid sm:grid-cols-3 gap-4 mt-12">
          <div className="rounded-lg p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
            <div className="text-sm font-mono font-bold mb-2" style={{ color: G.C }}>Drop-in API</div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Works with any LLM. No retraining or fine-tuning required.</p>
          </div>
          <div className="rounded-lg p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
            <div className="text-sm font-mono font-bold mb-2" style={{ color: G.R }}>Real-time Governance</div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Every output evaluated and corrected in milliseconds.</p>
          </div>
          <div className="rounded-lg p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
            <div className="text-sm font-mono font-bold mb-2" style={{ color: G.S }}>Cryptographic Proof</div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Every decision signed and publicly verifiable.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
