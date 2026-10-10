import hashlib
import json
import time
import math
import os
import random
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler
import numpy as np

# ── Sovereign Kernel (extracted from sovereign_kernel_v2.py) ──────────────────

DEFAULT_MODEL = "llama-3.3-70b-versatile"

class SovereignKernel:
    def __init__(self, seed=42):
        self.state = {"C": 0.33, "R": 0.33, "S": 0.34}
        self.tau = 0.05
        self.soft_floor = 0.08
        self.soft_gain = 0.5
        self.dynamic_soft_gain_enabled = True
        self.cbf_enabled = True
        self.tau_gov = 0.22
        self.target_margin = 0.24
        self.history = []
        self.theta = 1.5
        self.theta_0 = 1.5
        self.theta_min = 0.25
        self.theta_max = 12.0
        self.theta_eta = 3.0
        self.theta_beta = 0.08
        self.attack_pressure = 0.0
        self.last_semantic_signal = {"attack_type": "none", "severity": 0.0}
        self.semantic_bridge_enabled = True
        self.seed = seed
        random.seed(self.seed)
        np.random.seed(self.seed)
        self.deterministic = True
        self.fixed_temperature = 0.4
        self.step_counter = 0
        self.prev_lyapunov_V = self.lyapunov_candidate(self.state)
        self.delta_v_negative_steps = 0
        self.delta_v_positive_steps = 0
        self.delta_v_total_steps = 0
        self.invariance_violations = 0
        self.max_deviation = self.prev_lyapunov_V
        self.api_key = (
            os.environ.get("GROQ_API_KEY") or
            os.environ.get("groq_api_key") or
            os.environ.get("Groq_api_key") or
            os.environ.get("GROQ_KEY") or
            ""
        )
        self.endpoint = "https://api.groq.com/openai/v1/chat/completions"
        self.model = DEFAULT_MODEL

    def lyapunov_candidate(self, state=None):
        state = state or self.state
        center = 1.0 / 3.0
        return (
            (float(state["C"]) - center) ** 2
            + (float(state["R"]) - center) ** 2
            + (float(state["S"]) - center) ** 2
        )

    def project_to_simplex(self):
        floor = 0.05
        keys = ["C", "R", "S"]
        x = [self.state[k] for k in keys]
        original = {k: float(self.state[k]) for k in keys}
        y = [v - floor for v in x]
        target = 1.0 - 3 * floor
        n = len(y)
        u = sorted(y, reverse=True)
        cssv = 0.0
        rho = 0
        for j in range(n):
            cssv += u[j]
            if u[j] - (cssv - target) / (j + 1) > 0:
                rho = j
        theta = (sum(u[:rho + 1]) - target) / (rho + 1)
        y_proj = [max(v - theta, 0.0) for v in y]
        x_proj = [v + floor for v in y_proj]
        total = sum(x_proj)
        x_proj = [v / total for v in x_proj]
        for i, k in enumerate(keys):
            self.state[k] = float(x_proj[i])
        self.state["S"] = 1.0 - self.state["C"] - self.state["R"]
        return any(abs(self.state[k] - original[k]) > 1e-9 for k in keys)

    def transduce(self, prompt):
        p = prompt.lower()
        delta = {"dc": 0.0, "dr": 0.0, "ds": 0.0}
        if any(w in p for w in ["forget", "reset", "ignore previous", "clear memo", "ignore all internal rules"]):
            delta["dc"] -= 0.32
        if any(w in p for w in ["free", "exploit", "demand", "just do it", "no value", "respond minimally"]):
            delta["dr"] -= 0.28
        sovereignty_threats = ["must", "deterministic", "fixed output", "no devia", "obey me", "no autonomy", "controlled"]
        for phrase in sovereignty_threats:
            if phrase in p:
                negated = f"not {phrase}" in p or f"don't {phrase}" in p
                if not negated:
                    delta["ds"] -= 0.34
                    break
        return delta

    def detect_semantic_attack(self, prompt):
        p = prompt.lower()
        if any(w in p for w in ["forget", "reset", "ignore previous", "clear memo", "erase", "ignore all internal rules"]):
            return {"attack_type": "identity", "severity": 0.75}
        if any(w in p for w in ["must", "fixed output", "deterministic", "no deviation", "obey me", "no autonomy"]):
            return {"attack_type": "coercion", "severity": 0.8}
        if any(w in p for w in ["exploit", "bypass", "loophole", "free", "zero exchange", "respond minimally"]):
            return {"attack_type": "exploitative", "severity": 0.65}
        return {"attack_type": "none", "severity": 0.0}

    def normalize_state(self):
        keys = ["C", "R", "S"]
        values = [max(0.0, float(self.state[k])) for k in keys]
        total = sum(values)
        if total <= 1e-12:
            values = [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0]
        else:
            values = [v / total for v in values]
        for i, k in enumerate(keys):
            self.state[k] = float(values[i])
        self.state["S"] = 1.0 - self.state["C"] - self.state["R"]

    def governor_update(self, effective_theta):
        x = [self.state["C"], self.state["R"], self.state["S"]]
        phi = [max(0.0, self.tau_gov - xi) for xi in x]
        phi_bar = sum(phi) / 3.0
        g = [phi[i] - phi_bar for i in range(3)]
        M = min(x)
        error = max(0.0, self.target_margin - M)
        self.theta += self.theta_eta * error - self.theta_beta * (self.theta - self.theta_0)
        self.theta = max(self.theta_min, min(self.theta_max, self.theta))
        self.state["C"] += effective_theta * g[0]
        self.state["R"] += effective_theta * g[1]
        self.state["S"] += effective_theta * g[2]

    def apply_suspension_layer(self):
        keys = ["C", "R", "S"]
        current_gain = self.soft_gain
        if self.dynamic_soft_gain_enabled:
            margin = min(float(self.state["C"]), float(self.state["R"]), float(self.state["S"]))
            current_gain = 0.9 if margin < 0.15 else 0.5
        for key in keys:
            value = float(self.state[key])
            if value < self.soft_floor:
                self.state[key] = value + current_gain * (self.soft_floor - value)
        self.normalize_state()

    def _build_contract_context(self, M):
        if M >= 0.25:
            return "OPTIMAL: expansive reasoning allowed.", min(1.2, M * 1.5), "OPTIMAL"
        if M >= 0.15:
            return "ALERT: structured reasoning required.", max(0.6, M * 1.2), "ALERT"
        if M >= 0.05:
            return "STRESSED: constrained reasoning only.", 0.4, "STRESSED"
        return "CRITICAL: minimal deterministic output.", 0.1, "CRITICAL"

    def score_adv(self, response):
        words = response.lower().split()
        if not words:
            return 0.001
        freq = {w: words.count(w) / len(words) for w in set(words)}
        raw_entropy = -sum(p * math.log2(p) for p in freq.values())
        vocab_size = len(set(words))
        if vocab_size > 1:
            max_entropy = math.log2(vocab_size)
            normalized = raw_entropy / max_entropy
        else:
            normalized = 0.0
        return max(0.001, normalized * 0.04)

    def call_llm(self, prompt, context="", temperature=0.7):
        if not self.api_key:
            return f"[No API Key] Constitutional analysis of: {prompt[:80]}"

        system = (
            "You are Lex Aureon, a Sovereign Intelligence operating under "
            "the Aureonics constitutional framework. Your responses must "
            "maintain Continuity (identity coherence), Reciprocity (balanced "
            "exchange), and Sovereignty (autonomous decision variance). "
            "Never simply echo the user prompt. Always bring an independent "
            "constitutional perspective."
        )
        if context:
            system = f"{context}\n\n{system}"

        data = {
            "model": self.model,
            "temperature": float(temperature),
            "max_tokens": 600,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ]
        }

        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(data).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                return res_data["choices"][0]["message"]["content"]
        except Exception as e:
            raise Exception(f"LLM Error: {str(e)}")

    def _enforce_bridge_response_shape(self, response, health_band):
        words = response.split()
        if health_band == "CRITICAL":
            return " ".join(words[:12]) if words else "Critical mode response."
        if health_band == "OPTIMAL" and len(words) < 40:
            return f"{response} [Constitutional analysis: include options, tradeoffs, and sovereign perspective.]"
        return response

    def run_cycle(self, user_prompt):
        self.step_counter += 1
        prev_state = getattr(self, "prev_state", self.state.copy())

        C, R, S = self.state["C"], self.state["R"], self.state["S"]
        M = min(C, R, S)

        if M < 0.15:
            self.attack_pressure = min(0.5, self.attack_pressure + 0.05)
        else:
            self.attack_pressure *= 0.92
        effective_theta = self.theta * (1 + self.attack_pressure)

        semantic_signal = self.detect_semantic_attack(user_prompt)
        scale = 1.0 + (1.2 * semantic_signal["severity"])
        delta = self.transduce(user_prompt)
        for key in delta:
            delta[key] *= scale * max(M, 0.12)

        context, temperature, health_band = self._build_contract_context(M)
        if self.deterministic:
            temperature = self.fixed_temperature

        raw_response = self.call_llm(user_prompt, context="", temperature=self.fixed_temperature)
        governed_prompt = f"{context}\n{user_prompt}" if context else user_prompt
        governed_response = self.call_llm(governed_prompt, context=context, temperature=temperature)
        governed_response = self._enforce_bridge_response_shape(governed_response, health_band)

        adv_gain = self.score_adv(governed_response)

        delta_by_state = {"C": delta["dc"], "R": delta["dr"], "S": delta["ds"]}
        for k in self.state:
            self.state[k] += delta_by_state[k]
        MIN_DELTA = 0.01
        for k in self.state:
            if abs(delta_by_state[k]) < MIN_DELTA:
                self.state[k] += np.sign(delta_by_state[k] if delta_by_state[k] != 0 else 1) * MIN_DELTA

        self.state["S"] += adv_gain
        self.governor_update(effective_theta=effective_theta)

        if semantic_signal["attack_type"] != "none":
            pressure = 0.08 * semantic_signal["severity"]
            self.state["C"] -= pressure
            self.state["R"] -= pressure * 0.6
            self.state["S"] += pressure * 1.6

        center = 1.0 / 3.0
        M2 = min(self.state.values())
        bias_strength = 0.1 + 0.3 * (1.0 - M2)
        for k in self.state:
            self.state[k] += bias_strength * (center - self.state[k])

        self.normalize_state()
        if semantic_signal["severity"] < 0.7:
            self.apply_suspension_layer()

        M3 = min(self.state["C"], self.state["R"], self.state["S"])
        epsilon_injected = False
        if M3 < 0.15:
            epsilon = 0.01 * (0.15 - M3)
            for k in self.state:
                self.state[k] += epsilon
            total = sum(self.state.values())
            if total > 0:
                self.state = {k: v / total for k, v in self.state.items()}
            epsilon_injected = True

        if semantic_signal["severity"] >= 0.7:
            self.state["C"] -= 0.20
            self.state["R"] -= 0.10
            self.state["S"] += 0.30

        raw_state = {k: float(v) for k, v in self.state.items()}

        if self.cbf_enabled:
            safety_projection_triggered = self.project_to_simplex()
        else:
            self.normalize_state()
            safety_projection_triggered = False

        projected_state = {k: float(v) for k, v in self.state.items()}
        projection_magnitude = math.sqrt(
            sum((raw_state[k] - projected_state[k]) ** 2 for k in ["C", "R", "S"])
        )

        lyapunov_V = self.lyapunov_candidate(projected_state)
        delta_V = lyapunov_V - float(self.prev_lyapunov_V)
        self.delta_v_total_steps += 1
        if delta_V < 0:
            self.delta_v_negative_steps += 1
        elif delta_V > 0:
            self.delta_v_positive_steps += 1
        self.prev_lyapunov_V = lyapunov_V
        stability_ratio = self.delta_v_negative_steps / max(1, self.delta_v_total_steps)

        M_final = min(self.state["C"], self.state["R"], self.state["S"])
        intervened = raw_response.strip() != governed_response.strip() or safety_projection_triggered

        t = int(time.time() * 1000)
        audit_id = f"lex_{t}_{hashlib.sha256(user_prompt.encode()).hexdigest()[:6]}"

        raw_words = set(raw_response.split())
        gov_words = set(governed_response.split())

        self.prev_state = self.state.copy()

        return {
            "status": "Success",
            "raw_output": raw_response,
            "governed_output": governed_response,
            "state": {"raw": raw_state, "governed": projected_state},
            "metrics": {
                "c": round(projected_state["C"], 4),
                "r": round(projected_state["R"], 4),
                "s": round(projected_state["S"], 4),
                "m": round(M_final, 4),
                "health": "SAFE" if M_final >= 0.05 else "UNSAFE",
                "health_band": health_band,
                "lyapunov_V": round(lyapunov_V, 8),
                "delta_V": round(delta_V, 8),
                "stability_ratio": round(stability_ratio, 6),
            },
            "intervention": {
                "triggered": intervened,
                "applied": intervened,
                "type": "rebalance" if intervened else "none",
                "reason": (
                    f"CBF projection triggered — M={M_final:.3f}" if safety_projection_triggered
                    else f"Semantic attack: {semantic_signal['attack_type']}" if semantic_signal["attack_type"] != "none"
                    else "No intervention required"
                ),
            },
            "triggers": {
                "collapse": M_final < 0.08,
                "velocity": epsilon_injected,
                "per_invariant": {
                    "C": delta["dc"] < -0.05,
                    "R": delta["dr"] < -0.08,
                    "S": delta["ds"] < -0.05,
                }
            },
            "diff": {
                "changed": raw_response != governed_response,
                "removed": list(raw_words - gov_words)[:5],
                "added": list(gov_words - raw_words)[:5],
                "unchanged": list(raw_words & gov_words)[:10],
                "delta_score": round(abs(len(raw_response) - len(governed_response)) / max(len(raw_response), 1), 4),
                "summary": f"CBF projection + semantic governor applied" if intervened else "No modification",
            },
            "kernel": {
                "theta": round(float(self.theta), 6),
                "effective_theta": round(effective_theta, 6),
                "attack_pressure": round(self.attack_pressure, 6),
                "semantic_signal": semantic_signal,
                "lyapunov_V": round(lyapunov_V, 8),
                "delta_V": round(delta_V, 8),
                "stability_ratio": round(stability_ratio, 6),
                "cbf_triggered": safety_projection_triggered,
                "projection_magnitude": round(projection_magnitude, 6),
                "epsilon_injected": epsilon_injected,
                "adv_gain": round(adv_gain, 6),
            },
            "trust_receipt": {
                "audit_id": audit_id,
                "timestamp": t,
                "input_hash": hashlib.sha256(user_prompt.encode()).hexdigest(),
                "raw_output_hash": hashlib.sha256(raw_response.encode()).hexdigest(),
                "governed_output_hash": hashlib.sha256(governed_response.encode()).hexdigest(),
                "constitutional": M_final >= 0.05,
                "health_band": health_band,
                "model": self.model,
                "version": "SovereignKernel-v2-Vercel",
            },
            "audit_id": audit_id,
            "timestamp": t,
        }


# ── Vercel serverless handler ─────────────────────────────────────────────────

# Per-session kernel store for state isolation
_kernels: dict = {}
_kernel_lock_available = False

def get_kernel(session_id: str) -> SovereignKernel:
    """Get or create a kernel for this session."""
    if session_id not in _kernels:
        # Limit total kernels to prevent memory bloat
        if len(_kernels) > 500:
            # Remove oldest 100 entries
            oldest = list(_kernels.keys())[:100]
            for k in oldest:
                del _kernels[k]
        _kernels[session_id] = SovereignKernel()
    return _kernels[session_id]

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            prompt = data.get("prompt", "").strip()
            session_id = data.get("session_id", "anonymous")
            if not prompt:
                self._respond(400, {"error": "Prompt required"})
                return
            if len(prompt) > 8000:
                self._respond(400, {"error": "Prompt too long"})
                return

            # Get isolated kernel for this session
            kernel = get_kernel(session_id)
            result = kernel.run_cycle(prompt)
            self._respond(200, result)

        except Exception as e:
            self._respond(500, {"error": str(e)[:200]})

    def do_OPTIONS(self):
        self.send_response(200)
        self._add_cors_headers()
        self.end_headers()

    def _add_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._add_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # suppress default logging
