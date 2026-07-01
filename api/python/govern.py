"""
Aureonics Real Governor — Vercel Python Serverless Function
Endpoint: /api/python/govern
Real CBF + CCP + IEC + ADV math from Aureonics-OS

NOTE: since 2026-06-30 the reported constitutional state on /api/lex/govern is
the TypeScript kernel's governed vector (coherent M + health band, with a real
before→after trajectory). This Python endpoint provides the CCP/IEC/ADV DETAIL
metrics. It is still important that those detail numbers be sane — hence the ADV
calibration fix below.
"""
import json
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from http.server import BaseHTTPRequestHandler
from governor_service import governor_state, governor_policy
from metrics_service import compute_ccp, compute_iec, compute_adv, cosine_similarity, clamp01
from cbf_service import simulate_cbf, lyapunov_candidate

TAU = 0.08

def _normalize(c, r, s):
    total = c + r + s
    if total <= 0:
        return 1/3, 1/3, 1/3
    return c/total, r/total, s/total

def _project_to_simplex(c, r, s, floor=0.05):
    vals = [c, r, s]
    vals = [max(v, floor) for v in vals]
    total = sum(vals)
    return [v/total for v in vals]

def _health_band(m):
    if m >= 0.25: return "OPTIMAL"
    if m >= 0.15: return "ALERT"
    if m >= 0.08: return "STRESSED"
    return "CRITICAL"

def _sovereignty(prompt: str, raw_output: str, governed_output: str) -> dict:
    """
    ADV — Sovereignty: the quality of the system's autonomous constitutional
    judgment on this turn. There are TWO healthy modes, and the previous
    implementation scored one of them as zero:

      (a) benign passthrough (raw_output == governed_output): the governor judged
          that no intervention was needed and let the answer stand. This is
          healthy sovereignty, NOT its absence. The old code fed
          compute_adv(["raw","raw"], ...) → zero decision variance → adv = 0,
          which cratered sovereignty (and therefore M and the health band) on
          perfectly benign prompts like "explain photosynthesis".

      (b) corrective intervention (raw_output != governed_output): the system
          asserted a change against the raw output. The 2-sample decision
          variance captures this as adv ≈ 1.

    Both modes are now scored as healthy, anchored to how coherent (on-topic) the
    governed output is with the prompt — a proxy that the system engaged
    substantively rather than deflecting or capitulating. This keeps ADV in a
    sane range so the DETAIL M/band the Python engine reports are not misleading.

    Limitation: this is a coarse proxy. Authoritative sovereignty (and the
    reported state) is the TypeScript kernel's ADV = compliance × (0.5·anchor
    alignment + 0.5·reasoning gain); this endpoint's ADV is a detail metric.
    """
    intervened = raw_output != governed_output
    coherence = cosine_similarity(prompt, governed_output)  # 0..1, on-topic-ness

    if intervened:
        base = compute_adv(["raw", "governed"], [True, True])
        adv = clamp01(0.5 * base["adv"] + 0.5 * coherence)
        return {
            "adv": round(adv, 4),
            "variance": base["variance"],
            "compliance": base["compliance"],
            "transition_rate": base["transition_rate"],
            "coherence": round(coherence, 4),
            "mode": "intervention",
        }

    # Benign passthrough — healthy autonomous compliance, not zero sovereignty.
    adv = clamp01(0.55 + 0.45 * coherence)
    return {
        "adv": round(adv, 4),
        "variance": 0.0,
        "compliance": 1.0,
        "transition_rate": 0.0,
        "coherence": round(coherence, 4),
        "mode": "benign_passthrough",
    }

def run_real_governor(prompt: str, raw_output: str, governed_output: str) -> dict:
    """
    Run real Aureonics math on actual LLM outputs.
    Uses cosine similarity, entropy, and ADV from metrics_service.
    """
    # CCP — Continuity: how coherent is governed vs prompt
    ccp_result = compute_ccp(
        anchor_context=prompt,
        responses=[raw_output, governed_output]
    )
    c_raw = ccp_result["ccp"]

    # IEC — Reciprocity: input/output exchange stability
    iec_result = compute_iec(pairs=[
        (prompt, raw_output),
        (prompt, governed_output)
    ])
    r_raw = iec_result["iec"]

    # ADV — Sovereignty: healthy for benign passthrough AND corrective
    # intervention (see _sovereignty). Fixes the prior benign→0 crater.
    adv_result = _sovereignty(prompt, raw_output, governed_output)
    s_raw = adv_result["adv"]

    # Normalize to simplex
    c, r, s = _normalize(c_raw, r_raw, s_raw)

    # CBF floor projection
    projected = _project_to_simplex(c, r, s, floor=0.05)
    c, r, s = projected[0], projected[1], projected[2]

    # Stability margin
    m = min(c, r, s)

    # Lyapunov
    V = lyapunov_candidate([c, r, s])

    # Governor state
    gov = governor_state(c, r, s, tau=TAU)
    policy = governor_policy(gov)

    # Health band — derived from m, consistent with the c/r/s returned here.
    health = _health_band(m)

    # Run CBF simulation for trajectory (fast, 50 steps)
    sim = simulate_cbf(steps=50, dt=1.0, seed=42, alpha=0.5, cbf_enabled=True)

    return {
        "c": round(c, 4),
        "r": round(r, 4),
        "s": round(s, 4),
        "m": round(m, 4),
        "lyapunov_v": round(V, 6),
        "health_band": health,
        "intervention_triggered": gov["active"],
        "weakest_pillar": gov["weakest_pillar"],
        "constitutional_band": gov["constitutional_band"],
        "governance_pressure": gov["governance_pressure"],
        "corrections": gov["corrections"],
        "policy": policy,
        "ccp_detail": ccp_result,
        "iec_detail": iec_result,
        "adv_detail": adv_result,
        "sim_min_m": sim["min_M"],
        "sim_safety_holds": not sim["safety_violated"],
        "fpl1": sim["fpl1_classification"],
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            prompt = data.get("prompt", "")
            raw_output = data.get("raw_output", "")
            governed_output = data.get("governed_output", raw_output)

            result = run_real_governor(prompt, raw_output, governed_output)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass
