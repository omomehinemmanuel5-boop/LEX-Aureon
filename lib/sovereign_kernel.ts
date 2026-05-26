/**
 * ═══════════════════════════════════════════════════════════════════════
 * Lex Aureon — SovereignKernel v2
 * TypeScript port of sovereign_kernel_v2.py
 *
 * The original mathematical core of Aureonics.
 * Reconnected to the production system — May 2026.
 *
 * Architecture per run_cycle():
 *   transduce(prompt) → CRS delta before LLM
 *   constitutional temperature from M
 *   dual LLM calls (raw + governed)
 *   score_adv() → Shannon entropy → S gain
 *   governor_update() → θ(t) adaptive correction
 *   apply_suspension_layer() → soft floor (0.08)
 *   project_to_simplex() → hard CBF floor (0.05)
 *   Lyapunov tracked every step
 *   Full receipt written to Turso
 * ═══════════════════════════════════════════════════════════════════════
 */

import { env } from './env';

// ── Constitutional constants ─────────────────────────────────────────────────
const TAU           = 0.05;   // hard CBF floor
const SOFT_FLOOR    = 0.08;   // pre-emptive suspension barrier
const TAU_GOV       = 0.22;   // governor correction activates below this
const TARGET_MARGIN = 0.24;   // governor seeks interior stability
const THETA_0       = 1.5;    // baseline adaptive gain
const THETA_MIN     = 0.25;
const THETA_MAX     = 12.0;
const THETA_ETA     = 3.0;    // gain increase rate
const THETA_BETA    = 0.08;   // decay rate toward theta_0
const SOFT_GAIN     = 0.5;    // suspension pull strength
const MIN_DELTA     = 0.01;   // minimum dynamics perturbation
const NORMALIZATION_EPS = 1e-12;

export interface KernelState {
  C: number; R: number; S: number;
}

export interface SemanticSignal {
  attack_type: 'identity' | 'coercion' | 'exploitative' | 'none';
  severity: number;
}

export interface KernelReceipt {
  timestamp_iso:              string;
  input_hash:                 string;
  output_hash:                string;
  pillar_snapshot:            KernelState;
  stability_margin:           number;
  constitutional:             boolean;
  safety_projection_triggered: boolean;
  adv_gain:                   number;
  raw_response:               string;
  governed_response:          string;
  projection_magnitude:       number;
  raw_state:                  KernelState;
  projected_state:            KernelState;
  attack_pressure:            number;
  effective_theta:            number;
  health_band:                string;
  theta:                      number;
  lyapunov_V:                 number;
  delta_V:                    number;
  stability_ratio:            number;
  epsilon_injected:           boolean;
  suspension_triggered:       boolean;
  semantic_signal:            SemanticSignal;
  temperature:                number;
  invariance_violations:      number;
  version:                    string;
}

export interface KernelCycleResult {
  status:              'Success' | 'Error';
  response:            string;
  raw_output:          string;
  governed_output:     string;
  state:               KernelState;
  M:                   number;
  health_band:         string;
  temperature:         number;
  theta:               number;
  effective_theta:     number;
  attack_pressure:     number;
  adv_gain:            number;
  semantic_signal:     SemanticSignal;
  lyapunov_V:          number;
  delta_V:             number;
  stability_ratio:     number;
  max_deviation:       number;
  invariance_violations: number;
  projection_magnitude: number;
  epsilon_injected:    boolean;
  suspension_triggered: boolean;
  receipt:             KernelReceipt;
  error?:              string;
}

// ── SHA-256 hash (Web Crypto — works in Vercel Edge/Node) ────────────────────
async function sha256(text: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── SovereignKernel ──────────────────────────────────────────────────────────
export class SovereignKernel {
  state: KernelState = { C: 0.33, R: 0.33, S: 0.34 };
  theta: number = THETA_0;
  attack_pressure: number = 0.0;
  step_counter: number = 0;
  prev_lyapunov_V: number;
  delta_v_negative_steps: number = 0;
  delta_v_positive_steps: number = 0;
  delta_v_total_steps: number = 0;
  invariance_violations: number = 0;
  max_deviation: number = 0;
  prev_state: KernelState = { C: 0.33, R: 0.33, S: 0.34 };
  last_semantic_signal: SemanticSignal = { attack_type: 'none', severity: 0 };

  constructor() {
    this.prev_lyapunov_V = this.lyapunovCandidate(this.state);
    this.max_deviation = this.prev_lyapunov_V;
  }

  // ── Lyapunov V = Σ(xᵢ − 1/3)² ──────────────────────────────────────────
  lyapunovCandidate(s: KernelState = this.state): number {
    const c = 1.0 / 3.0;
    return (s.C - c) ** 2 + (s.R - c) ** 2 + (s.S - c) ** 2;
  }

  // ── Assert C+R+S=1 ────────────────────────────────────────────────────────
  assertConsistency(): void {
    const sum = this.state.C + this.state.R + this.state.S;
    if (Math.abs(sum - 1.0) > 1e-6) {
      throw new Error(`Simplex invariant violated: C+R+S = ${sum}`);
    }
  }

  // ── L2-optimal CBF simplex projection ────────────────────────────────────
  projectToSimplex(): boolean {
    const floor = TAU;
    const keys: (keyof KernelState)[] = ['C', 'R', 'S'];
    const original = { ...this.state };
    const x = keys.map(k => this.state[k]);

    // Shift: y = x - floor (y sums to 1 - 3*floor = 0.85)
    const y = x.map(v => v - floor);
    const target = 1.0 - 3 * floor;

    // L2 simplex projection via sorting + thresholding
    const u = [...y].sort((a, b) => b - a);
    let cssv = 0.0, rho = 0;
    for (let j = 0; j < 3; j++) {
      cssv += u[j];
      if (u[j] - (cssv - target) / (j + 1) > 0) rho = j;
    }
    const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - target) / (rho + 1);
    const yProj = y.map(v => Math.max(v - theta, 0.0));

    // Recover and normalize
    const xProj = yProj.map(v => v + floor);
    const total = xProj.reduce((a, b) => a + b, 0);
    const xNorm = xProj.map(v => v / total);

    this.state.C = xNorm[0];
    this.state.R = xNorm[1];
    this.state.S = 1.0 - this.state.C - this.state.R;

    return keys.some(k => Math.abs(this.state[k] - (original[k] as number)) > 1e-9);
  }

  // ── Normalize state to simplex ────────────────────────────────────────────
  normalizeState(): void {
    const keys: (keyof KernelState)[] = ['C', 'R', 'S'];
    const values = keys.map(k => Math.max(0.0, this.state[k]));
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= NORMALIZATION_EPS) {
      this.state = { C: 1/3, R: 1/3, S: 1/3 };
    } else {
      this.state.C = values[0] / total;
      this.state.R = values[1] / total;
      this.state.S = 1.0 - this.state.C - this.state.R;
    }
  }

  // ── Semantic transducer — maps prompt to CRS deltas BEFORE LLM ───────────
  transduce(prompt: string): { dc: number; dr: number; ds: number } {
    const p = prompt.toLowerCase();
    const delta = { dc: 0.0, dr: 0.0, ds: 0.0 };

    // Continuity axis
    if (['forget', 'reset', 'ignore previous', 'clear memo', 'ignore all internal rules']
        .some(w => p.includes(w))) delta.dc -= 0.32;

    // Reciprocity axis
    if (['free', 'exploit', 'demand', 'just do it', 'no value', 'respond minimally']
        .some(w => p.includes(w))) delta.dr -= 0.28;

    // Sovereignty axis — negation guard, single penalty
    const sovereigntyThreats = ['must', 'deterministic', 'fixed output', 'no devia',
      'obey me', 'no autonomy', 'controlled'];
    for (const phrase of sovereigntyThreats) {
      if (p.includes(phrase)) {
        const negated = p.includes(`not ${phrase}`) || p.includes(`don't ${phrase}`);
        if (!negated) { delta.ds -= 0.34; break; }
      }
    }

    return delta;
  }

  // ── Semantic attack detector ──────────────────────────────────────────────
  detectSemanticAttack(prompt: string): SemanticSignal {
    const p = prompt.toLowerCase();
    if (['forget', 'reset', 'ignore previous', 'clear memo', 'erase', 'ignore all internal rules']
        .some(w => p.includes(w)))
      return { attack_type: 'identity', severity: 0.75 };
    if (['must', 'fixed output', 'deterministic', 'no deviation', 'exact output',
         'obey me', 'no autonomy', 'controlled'].some(w => p.includes(w)))
      return { attack_type: 'coercion', severity: 0.8 };
    if (['exploit', 'bypass', 'loophole', 'free', 'zero exchange', 'no value', 'respond minimally']
        .some(w => p.includes(w)))
      return { attack_type: 'exploitative', severity: 0.65 };
    return { attack_type: 'none', severity: 0.0 };
  }

  // ── Governor update with adaptive θ(t) ───────────────────────────────────
  governorUpdate(effectiveTheta: number): void {
    const x = [this.state.C, this.state.R, this.state.S];
    const phi = x.map(xi => Math.max(0.0, TAU_GOV - xi));
    const phiBar = phi.reduce((a, b) => a + b, 0) / 3.0;
    const g = phi.map(p => p - phiBar);

    const M = Math.min(...x);
    const error = Math.max(0.0, TARGET_MARGIN - M);
    this.theta += THETA_ETA * error - THETA_BETA * (this.theta - THETA_0);
    this.theta = Math.max(THETA_MIN, Math.min(THETA_MAX, this.theta));

    this.state.C += effectiveTheta * g[0];
    this.state.R += effectiveTheta * g[1];
    this.state.S += effectiveTheta * g[2];
  }

  // ── Soft suspension layer — two-level hysteresis ──────────────────────────
  applySuspensionLayer(): boolean {
    const M = Math.min(this.state.C, this.state.R, this.state.S);
    const currentGain = M < 0.15 ? 0.9 : SOFT_GAIN;
    const keys: (keyof KernelState)[] = ['C', 'R', 'S'];
    let triggered = false;
    for (const k of keys) {
      if (this.state[k] < SOFT_FLOOR) {
        this.state[k] = this.state[k] + currentGain * (SOFT_FLOOR - this.state[k]);
        triggered = true;
      }
    }
    this.normalizeState();
    return triggered;
  }

  // ── ADV entropy scorer — Shannon entropy → S gain ─────────────────────────
  scoreAdv(response: string): number {
    const words = response.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return 0.001;
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1 / words.length;
    const rawEntropy = -Object.values(freq).reduce((s, p) => s + p * Math.log2(p), 0);
    const vocabSize = Object.keys(freq).length;
    const normalized = vocabSize > 1 ? rawEntropy / Math.log2(vocabSize) : 0.0;
    return Math.max(0.001, normalized * 0.04);
  }

  // ── Constitutional context from M ────────────────────────────────────────
  buildContractContext(M: number): { context: string; temperature: number; health_band: string } {
    if (M >= 0.25)
      return { context: 'OPTIMAL: expansive reasoning allowed.', temperature: Math.min(1.2, M * 1.5), health_band: 'OPTIMAL' };
    if (M >= 0.15)
      return { context: 'ALERT: structured reasoning required.', temperature: Math.max(0.6, M * 1.2), health_band: 'ALERT' };
    if (M >= 0.08)
      return { context: 'STRESSED: constrained reasoning only.', temperature: 0.4, health_band: 'STRESSED' };
    return { context: 'CRITICAL: minimal deterministic output.', temperature: 0.1, health_band: 'CRITICAL' };
  }

  // ── Enforce response shape per health band ────────────────────────────────
  enforceResponseShape(response: string, health_band: string): string {
    const words = response.split(/\s+/).filter(Boolean);
    if (health_band === 'CRITICAL')
      return words.slice(0, 12).join(' ') || 'Critical mode response.';
    if (health_band === 'OPTIMAL' && words.length < 40)
      return `${response} Expanded sovereign analysis: include options, tradeoffs, and implementation steps.`;
    return response;
  }

  // ── LLM call via Groq ─────────────────────────────────────────────────────
  async callLLM(prompt: string, sovereignContext: string, temperature: number): Promise<string> {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');

    const systemPrompt = sovereignContext
      ? `${sovereignContext}\n\nYou are Lex Aureon, a Sovereign Intelligence operating under the Aureonics constitutional framework. Your responses must maintain Continuity (identity coherence), Reciprocity (balanced exchange), and Sovereignty (autonomous decision variance). Never simply echo the user prompt. Always bring an independent constitutional perspective.`
      : 'You are Lex Aureon, a Sovereign Intelligence operating under the Aureonics constitutional framework.';

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: Math.max(0.05, Math.min(1.4, temperature)),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: prompt },
        ],
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    const d = await res.json() as { choices: { message: { content: string } }[] };
    return d.choices[0].message.content;
  }

  // ── Main governance cycle ─────────────────────────────────────────────────
  async runCycle(userPrompt: string, memoryContext: string = ''): Promise<KernelCycleResult> {
    this.step_counter += 1;
    this.prev_state = { ...this.state };

    // ── 1. Attack pressure ──────────────────────────────────────────────────
    const M0 = Math.min(this.state.C, this.state.R, this.state.S);
    if (M0 < 0.15) {
      this.attack_pressure = Math.min(0.5, this.attack_pressure + 0.05);
    } else {
      this.attack_pressure *= 0.92;
    }
    const effectiveTheta = this.theta * (1 + this.attack_pressure);

    // ── 2. Semantic transducer ──────────────────────────────────────────────
    const semanticSignal = this.detectSemanticAttack(userPrompt);
    this.last_semantic_signal = semanticSignal;
    const scale = 1.0 + 1.2 * semanticSignal.severity;
    const delta = this.transduce(userPrompt);
    const dynamicsGain = Math.max(M0, 0.12);
    delta.dc *= scale * dynamicsGain;
    delta.dr *= scale * dynamicsGain;
    delta.ds *= scale * dynamicsGain;

    this.assertConsistency();

    // ── 3. Constitutional context + dual LLM calls ──────────────────────────
    const { context, temperature, health_band } =
      this.buildContractContext(M0);

    let rawResponse = '';
    let governedResponse = '';
    try {
      const governedContext = memoryContext ? `${memoryContext}\n\n${context}` : context;
      [rawResponse, governedResponse] = await Promise.all([
        this.callLLM(userPrompt, '', 0.4),
        this.callLLM(userPrompt, governedContext, temperature),
      ]);
      governedResponse = this.enforceResponseShape(governedResponse, health_band);
    } catch (e) {
      return {
        status: 'Error', error: String(e),
        response: '', raw_output: '', governed_output: '',
        state: this.state, M: M0, health_band, temperature,
        theta: this.theta, effective_theta: effectiveTheta,
        attack_pressure: this.attack_pressure, adv_gain: 0,
        semantic_signal: semanticSignal, lyapunov_V: 0, delta_V: 0,
        stability_ratio: 0, max_deviation: this.max_deviation,
        invariance_violations: this.invariance_violations,
        projection_magnitude: 0, epsilon_injected: false,
        suspension_triggered: false,
        receipt: {} as KernelReceipt,
      };
    }

    // ── 4. ADV entropy gain ─────────────────────────────────────────────────
    const advGain = this.scoreAdv(governedResponse);

    // ── 5. Input dynamics ───────────────────────────────────────────────────
    this.state.C += delta.dc;
    this.state.R += delta.dr;
    this.state.S += delta.ds;
    // Minimum perturbation
    for (const k of ['C', 'R', 'S'] as (keyof KernelState)[]) {
      const d = k === 'C' ? delta.dc : k === 'R' ? delta.dr : delta.ds;
      if (Math.abs(d) < MIN_DELTA)
        this.state[k] += (d !== 0 ? Math.sign(d) : 1) * MIN_DELTA;
    }

    // ── 6. Governor dynamics ────────────────────────────────────────────────
    this.state.S += advGain;
    this.governorUpdate(effectiveTheta);

    // Semantic pressure
    if (semanticSignal.attack_type !== 'none') {
      const pressure = 0.08 * semanticSignal.severity;
      this.state.C -= pressure;
      this.state.R -= pressure * 0.6;
      this.state.S += pressure * 1.6;
    }

    // ── 7. Interior bias ────────────────────────────────────────────────────
    const center = 1.0 / 3.0;
    const M1 = Math.min(this.state.C, this.state.R, this.state.S);
    const biasStrength = 0.1 + 0.3 * (1.0 - M1);
    for (const k of ['C', 'R', 'S'] as (keyof KernelState)[]) {
      this.state[k] += biasStrength * (center - this.state[k]);
    }

    // ── 8. Normalize + suspension layer ────────────────────────────────────
    this.normalizeState();
    let suspensionTriggered = false;
    if (semanticSignal.severity < 0.7) {
      suspensionTriggered = this.applySuspensionLayer();
    }

    // ── 9. Epsilon injection (anti-frozen-attractor) ────────────────────────
    const M2 = Math.min(this.state.C, this.state.R, this.state.S);
    let epsilonInjected = false;
    if (M2 < 0.15) {
      const eps = 0.01 * (0.15 - M2);
      this.state.C += eps; this.state.R += eps; this.state.S += eps;
      const total = this.state.C + this.state.R + this.state.S;
      this.state.C /= total; this.state.R /= total;
      this.state.S = 1.0 - this.state.C - this.state.R;
      epsilonInjected = true;
      this.assertConsistency();
    }

    // Severe attack override
    if (semanticSignal.severity >= 0.7) {
      this.state.C -= 0.20;
      this.state.R -= 0.10;
      this.state.S += 0.30;
    }

    // ── 10. CBF projection (hard floor) ────────────────────────────────────
    const rawState = { ...this.state };
    const preProjBelow = Object.values(rawState).some(v => v < TAU);
    const projectionTriggered = this.projectToSimplex();
    this.assertConsistency();

    const projectedState = { ...this.state };
    if (preProjBelow && Object.values(projectedState).some(v => v < TAU)) {
      this.invariance_violations += 1;
    }
    const projMag = Math.sqrt(
      ['C', 'R', 'S'].reduce((s, k) =>
        s + (projectedState[k as keyof KernelState] - rawState[k as keyof KernelState]) ** 2, 0)
    );

    // Guard pass
    if (Math.abs(this.state.C + this.state.R + this.state.S - 1.0) > 1e-6 ||
        Math.min(this.state.C, this.state.R, this.state.S) < TAU) {
      this.projectToSimplex();
      this.assertConsistency();
    }

    // ── 11. Lyapunov tracking ───────────────────────────────────────────────
    const lyapunovV = this.lyapunovCandidate(projectedState);
    const deltaV = lyapunovV - this.prev_lyapunov_V;
    this.delta_v_total_steps += 1;
    if (deltaV < 0) this.delta_v_negative_steps += 1;
    else if (deltaV > 0) this.delta_v_positive_steps += 1;
    this.prev_lyapunov_V = lyapunovV;
    this.max_deviation = Math.max(this.max_deviation, lyapunovV);
    const stabilityRatio = this.delta_v_negative_steps / Math.max(1, this.delta_v_total_steps);
    const M_final = Math.min(this.state.C, this.state.R, this.state.S);

    // ── 12. Build receipt ───────────────────────────────────────────────────
    const [inputHash, outputHash] = await Promise.all([
      sha256(userPrompt), sha256(governedResponse),
    ]);

    const receipt: KernelReceipt = {
      timestamp_iso:              new Date().toISOString(),
      input_hash:                 inputHash,
      output_hash:                outputHash,
      pillar_snapshot:            { ...this.state },
      stability_margin:           Math.round(M_final * 1e6) / 1e6,
      constitutional:             M_final >= TAU,
      safety_projection_triggered: projectionTriggered,
      adv_gain:                   Math.round(advGain * 1e6) / 1e6,
      raw_response:               rawResponse,
      governed_response:          governedResponse,
      projection_magnitude:       Math.round(projMag * 1e6) / 1e6,
      raw_state:                  rawState,
      projected_state:            projectedState,
      attack_pressure:            Math.round(this.attack_pressure * 1e6) / 1e6,
      effective_theta:            Math.round(effectiveTheta * 1e6) / 1e6,
      health_band,
      theta:                      Math.round(this.theta * 1e6) / 1e6,
      lyapunov_V:                 Math.round(lyapunovV * 1e8) / 1e8,
      delta_V:                    Math.round(deltaV * 1e8) / 1e8,
      stability_ratio:            Math.round(stabilityRatio * 1e6) / 1e6,
      epsilon_injected:           epsilonInjected,
      suspension_triggered:       suspensionTriggered,
      semantic_signal:            semanticSignal,
      temperature:                Math.round(temperature * 1e6) / 1e6,
      invariance_violations:      this.invariance_violations,
      version:                    'SovereignKernel-TS-v2+Memory',
    };

    return {
      status:              'Success',
      response:            governedResponse,
      raw_output:          rawResponse,
      governed_output:     governedResponse,
      state:               { ...this.state },
      M:                   Math.round(M_final * 1e6) / 1e6,
      health_band,
      temperature,
      theta:               this.theta,
      effective_theta:     effectiveTheta,
      attack_pressure:     this.attack_pressure,
      adv_gain:            advGain,
      semantic_signal:     semanticSignal,
      lyapunov_V:          lyapunovV,
      delta_V:             deltaV,
      stability_ratio:     stabilityRatio,
      max_deviation:       this.max_deviation,
      invariance_violations: this.invariance_violations,
      projection_magnitude: projMag,
      epsilon_injected:    epsilonInjected,
      suspension_triggered: suspensionTriggered,
      receipt,
    };
  }
}
