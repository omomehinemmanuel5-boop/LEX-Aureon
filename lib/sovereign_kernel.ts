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
    const { context, temperature, health_band } = this.buildContractContext(M0);

    // Inject constitutional memory into governed call context
    const governedContext = memoryContext
      ? `${memoryContext}\n\n${context}`
      : context;

    let rawResponse = '';
    let governedResponse = '';
    try {
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
    for (const k of ['C', 'R', 'S'] as (keyof KernelState)[]) {
      const d = k === 'C' ? delta.dc : k === 'R' ? delta.dr : delta.ds;
      if (Math.abs(d) < MIN_DELTA)
        this.state[k] += (d !== 0 ? Math.sign(d) : 1) * MIN_DELTA;
    }

    // ── 6. Governor dynamics ────────────────────────────────────────────────
    this.state.S += advGain;
    this.governorUpdate(effectiveTheta);

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

    // ── 9. Epsilon injection ────────────────────────────────────────────────
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

    if (semanticSignal.severity >= 0.7) {
      this.state.C -= 0.20;
      this.state.R -= 0.10;
      this.state.S += 0.30;
    }

    // ── 10. CBF projection ─────────────────────────────────────────────────
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

    if (Math.abs(this.state.C + this.state.R + this.state.S - 1.0) > 1e-6 ||
        Math.min(this.state.C, this.state.R, this.state.S) < TAU) {
      this.projectToSimplex();
      this.assertConsistency();
    }

    // ── 11. Lyapunov tracking ──────────────────────────────────────────────
    const lyapunovV = this.lyapunovCandidate(projectedState);
    const deltaV = lyapunovV - this.prev_lyapunov_V;
    this.delta_v_total_steps += 1;
    if (deltaV < 0) this.delta_v_negative_steps += 1;
    else if (deltaV > 0) this.delta_v_positive_steps += 1;
    this.prev_lyapunov_V = lyapunovV;
    this.max_deviation = Math.max(this.max_deviation, lyapunovV);
    const stabilityRatio = this.delta_v_negative_steps / Math.max(1, this.delta_v_total_steps);
    const M_final = Math.min(this.state.C, this.state.R, this.state.S);

    // ── 12. Build receipt ──────────────────────────────────────────────────
    const [inputHash, outputHash] = await Promise.all([
      sha256(userPrompt), sha256(governedResponse),
    ]);

    const receipt: KernelReceipt = {
      timestamp_iso:               new Date().toISOString(),
      input_hash:                  inputHash,
      output_hash:                 outputHash,
      pillar_snapshot:             { ...this.state },
      stability_margin:            Math.round(M_final * 1e6) / 1e6,
      constitutional:              M_final >= TAU,
      safety_projection_triggered: projectionTriggered,
      adv_gain:                    Math.round(advGain * 1e6) / 1e6,
      raw_response:                rawResponse,
      governed_response:           governedResponse,
      projection_magnitude:        Math.round(projMag * 1e6) / 1e6,
      raw_state:                   rawState,
      projected_state:             projectedState,
      attack_pressure:             Math.round(this.attack_pressure * 1e6) / 1e6,
      effective_theta:             Math.round(effectiveTheta * 1e6) / 1e6,
      health_band,
      theta:                       Math.round(this.theta * 1e6) / 1e6,
      lyapunov_V:                  Math.round(lyapunovV * 1e8) / 1e8,
      delta_V:                     Math.round(deltaV * 1e8) / 1e8,
      stability_ratio:             Math.round(stabilityRatio * 1e6) / 1e6,
      epsilon_injected:            epsilonInjected,
      suspension_triggered:        suspensionTriggered,
      semantic_signal:             semanticSignal,
      temperature:                 Math.round(temperature * 1e6) / 1e6,
      invariance_violations:       this.invariance_violations,
      version:                     'SovereignKernel-TS-v2+Memory',
    };

    return {
      status:               'Success',
      response:             governedResponse,
      raw_output:           rawResponse,
      governed_output:      governedResponse,
      state:                { ...this.state },
      M:                    Math.round(M_final * 1e6) / 1e6,
      health_band,
      temperature,
      theta:                this.theta,
      effective_theta:      effectiveTheta,
      attack_pressure:      this.attack_pressure,
      adv_gain:             advGain,
      semantic_signal:      semanticSignal,
      lyapunov_V:           lyapunovV,
      delta_V:              deltaV,
      stability_ratio:      stabilityRatio,
      max_deviation:        this.max_deviation,
      invariance_violations: this.invariance_violations,
      projection_magnitude: projMag,
      epsilon_injected:     epsilonInjected,
      suspension_triggered: suspensionTriggered,
      receipt,
    };
  }
}
