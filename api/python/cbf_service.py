"""
Aureonics CBF Governor Service
==============================
Architecture:
  intrinsic_dynamics  →  adaptive governor  →  basin force  →  CBF filter  →  state update

CBF is always applied LAST, guaranteeing min(x_i) >= TAU_CBF for all time.
Basin Intelligence Layer shapes convergence toward meaningful interior structure.
"""
import json
import math
import os
import random

# ── Safety parameters ──────────────────────────────────────────────────────────
TAU_CBF = 0.05          # safety floor: no pillar may fall below this
DT_DEFAULT = 1.0        # time step

# ── Governor parameters ────────────────────────────────────────────────────────
TAU_GOV = 0.25          # governor correction activates below this threshold
THETA_0 = 1.0           # baseline adaptive gain
THETA_MIN = 0.1
THETA_MAX = 5.0
ALPHA_THETA = 0.8       # gain increase rate on error
BETA_THETA = 0.05       # decay rate toward theta_0
DEADZONE = 0.01         # ignore tiny errors
TARGET_MARGIN = 0.33    # desired stability margin (simplex centroid)

# ── Noise parameters ──────────────────────────────────────────────────────────
NOISE_SIGMA = 0.08
NOISE_CLIP = 0.15

# ── Basin Intelligence parameters ─────────────────────────────────────────────
LAMBDA_GAIN = 0.2       # basin force gain
MAX_FORCE_NORM = 1.0    # cap total basin force L1 norm
MARGIN_SAFETY_CUTOFF = 0.1   # zero basin force when system is close to collapse

NORMALIZATION_EPSILON = 1e-12
FLOAT_TOLERANCE = 1e-9  # floating-point noise threshold for safety check

# ── Lyapunov certificate parameters (2026-07-18 fix — see below) ──────────────
MU_LYAPUNOV = 2.0        # Barrier penalty weight — matches lib/aureonics_core.ts's MU
LYAPUNOV_FLOOR = 1e-9    # Prevents log(0) — matches lib/aureonics_core.ts's FLOOR


def lyapunov_quadratic(x: list[float]) -> float:
    """
    The SUPERSEDED candidate this file used until 2026-07-18: V(x) = sum((x_i - 1/3)^2).
    Kept for reference/comparison only — no longer called by simulate_cbf().
    Matches lib/aureonics_core.ts's lyapunovQuadratic(), which is likewise kept
    there only as a labeled historical alternative, not the live certificate.
    """
    center = 1.0 / 3.0
    return sum((xi - center) ** 2 for xi in x)


def lyapunov_candidate(x: list[float], z: list[float] | None = None) -> float:
    """
    fix (2026-07-18) — THE PUBLISHED CERTIFICATE, NOT A SUBSTITUTE: this
    function previously computed the simple quadratic V(x) = sum((x_i-1/3)^2)
    (see lyapunov_quadratic above), not the Aureonics §11 published
    certificate. Direct comparison against lib/aureonics_core.ts's
    lyapunovBarrierZ() (the TypeScript kernel's live certificate) found the
    two were never the same function — this file was silently substituting a
    simpler, unpublished candidate for the one the paper actually claims.

    Now matches lyapunovBarrierZ() exactly:
        V_z(x) = -sum(z_i * log(x_i)) + (mu/2) * sum(max(0, tau - x_i)^2)
    z defaults to uniform (1/3, 1/3, 1/3) — this simulation has no
    session-specific z (it's an offline system-property proof, not a live
    session), matching the TypeScript side's own Z_RECOVERY fallback for
    exactly that case.

    IMPORTANT, VERIFIED BY DIRECT LOCAL TESTING (2026-07-18) — fixing this
    formula does NOT by itself make the FPL-1 classification below pass, and
    should not be assumed to:
      - This candidate has a nonzero floor even at the ideal centroid
        (-log(1/3) ≈ 1.0986, uniform z), unlike the quadratic's floor of 0.
        Comparing its RAW value against the quadratic-calibrated 0.25
        threshold is meaningless — raw values run ~1.1-1.5 across 5 tested
        seeds, always exceeding 0.25 regardless of actual stability.
      - Even the mathematically correct fix — measuring EXCURSION from V(0)
        rather than raw V, which is what "deviation" should mean for any
        Lyapunov-style certificate with a nonzero interior minimum — still
        produced 0.27-0.40 across the same 5 seeds under this file's current
        noise/gain parameters (NOISE_SIGMA=0.08, THETA_0=1.0, etc.), and
        stability_ratio sat at 0.52-0.58, below the existing 0.6 bar,
        REGARDLESS of which candidate was used to compute it (verified
        against both lyapunov_quadratic and this function on identical
        trajectories).
    In short: the candidate was genuinely wrong and is now fixed, but FPL-1
    passing or failing is a separate, still-open question — see
    simulate_cbf()'s fpl1_report for the honest excursion-based numbers
    rather than a classification that was quietly re-thresholded to make
    the failure disappear.
    """
    if z is None:
        z = [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0]
    barrier = -sum(z[i] * math.log(max(x[i], LYAPUNOV_FLOOR)) for i in range(3))
    penalty = (MU_LYAPUNOV / 2.0) * sum(max(0.0, TAU_CBF - xi) ** 2 for xi in x)
    return barrier + penalty


# ══════════════════════════════════════════════════════════════════════════════
# Dynamics
# ══════════════════════════════════════════════════════════════════════════════

def _gauss_clip(rng: random.Random, sigma: float, clip: float) -> float:
    return max(-clip, min(clip, rng.gauss(0.0, sigma)))


def _replicator(x: list[float], alpha: float = 0.5) -> list[float]:
    """Standard replicator dynamics — mass-conserving."""
    a = [0.5, 0.5, 0.5]
    fitness = [
        a[0] - alpha * (x[1] + x[2]),
        a[1] - alpha * (x[0] + x[2]),
        a[2] - alpha * (x[0] + x[1]),
    ]
    f_bar = sum(x[i] * fitness[i] for i in range(3))
    return [x[i] * (fitness[i] - f_bar) for i in range(3)]


def _intrinsic_dynamics(x: list[float], rng: random.Random, alpha: float = 0.5) -> list[float]:
    """Replicator + bounded, mass-conserving Gaussian noise."""
    rep = _replicator(x, alpha)
    noise_raw = [_gauss_clip(rng, NOISE_SIGMA, NOISE_CLIP) for _ in range(3)]
    noise_mean = sum(noise_raw) / 3.0
    noise_mc = [n - noise_mean for n in noise_raw]
    return [rep[i] + noise_mc[i] for i in range(3)]


# ══════════════════════════════════════════════════════════════════════════════
# Adaptive Governor
# ══════════════════════════════════════════════════════════════════════════════

def _governor_G(x: list[float], tau_gov: float = TAU_GOV) -> list[float]:
    """Mass-conserving governor correction vector G(x)."""
    phi = [max(0.0, tau_gov - xi) for xi in x]
    phi_bar = sum(phi) / 3.0
    return [phi[i] - phi_bar for i in range(3)]


# ══════════════════════════════════════════════════════════════════════════════
# Basin Intelligence Layer
# ══════════════════════════════════════════════════════════════════════════════

def compute_ccp(x: list[float], input_data: dict) -> float:
    """
    Constitutional Coherence Profile.
    Measures how close the state is to a balanced interior.
    CCP = 1.0 at the centroid [1/3, 1/3, 1/3], 0.0 at any corner.
    An external signal can shift the effective CCP up or down.
    """
    centroid = 1.0 / 3.0
    variance = sum((xi - centroid) ** 2 for xi in x)
    ccp_base = max(0.0, 1.0 - 1.5 * variance)   # 1 - (3/2)*sum((xi-1/3)^2)
    signal = float(input_data.get("signal", 0.0))
    return min(1.0, max(0.0, ccp_base + 0.1 * signal))


def compute_iec(x: list[float], input_data: dict) -> float:
    """
    Internal Energy Coherence.
    Measures distance from collapse: IEC = 3*min(x).
    IEC = 1.0 at centroid, 0.0 at any corner vertex.
    """
    iec_base = 3.0 * min(x)
    signal = float(input_data.get("signal", 0.0))
    return min(1.0, max(0.0, iec_base + 0.05 * signal))


def compute_phi(x: list[float], input_data: dict) -> float:
    """
    Potential function Φ(x). Lower is better.
    Φ = -w1*CCP + w2*(IEC - IEC_target)^2
    System is directed toward high CCP and IEC near its target.
    """
    ccp = compute_ccp(x, input_data)
    iec = compute_iec(x, input_data)
    iec_target = float(input_data.get("iec_target", 1.0 / 3.0))
    w1 = 1.0
    w2 = 0.5
    return -w1 * ccp + w2 * (iec - iec_target) ** 2


def cap_force(v: list[float], max_norm: float = MAX_FORCE_NORM) -> list[float]:
    """Cap force vector by L1 norm."""
    norm = sum(abs(vi) for vi in v)
    if norm > max_norm and norm > 0.0:
        scale = max_norm / norm
        return [vi * scale for vi in v]
    return list(v)


def compute_basin_force(x: list[float], input_data: dict) -> list[float]:
    """
    Basin force derived from the gradient of Φ, projected onto the simplex
    (zero mean → mass-conserving) and capped to MAX_FORCE_NORM.

    u_basin_i = -(∂Φ/∂x_i - mean(∂Φ/∂x)) * lambda_gain
    """
    eps = 1e-4
    grad = []
    for i in range(3):
        x_up = x[:]
        x_down = x[:]
        x_up[i] += eps
        x_down[i] -= eps
        dphi = (compute_phi(x_up, input_data) - compute_phi(x_down, input_data)) / (2.0 * eps)
        grad.append(dphi)
    mean_grad = sum(grad) / 3.0
    force = [-(g - mean_grad) * LAMBDA_GAIN for g in grad]
    return cap_force(force)


def identify_basin(x: list[float]) -> str:
    """
    Classify the current state into one of four constitutional basins.
    Thresholds are relative to the simplex interior.
    """
    labels = ["Analytical", "Collaborative", "Exploratory"]
    max_val = max(x)
    if max_val > 0.4:
        return labels[x.index(max_val)]
    return "Balanced"


# ══════════════════════════════════════════════════════════════════════════════
# CBF Safety Module
# (structured for future upgrade to full QP controller)
# ══════════════════════════════════════════════════════════════════════════════

def _cbf_safety_filter(
    x: list[float],
    f: list[float],
    u_des: list[float],
    tau_cbf: float = TAU_CBF,
    dt: float = DT_DEFAULT,
) -> list[float]:
    """
    Discrete-time CBF safety filter (exact QP solution for n=3).

    Guarantees: x_i(t+1) = x_i + dt*(f_i + u_i) >= tau_cbf for all i,
    while maintaining mass conservation (sum(u) = 0).

    min ||u - u_des||^2  s.t.  u_i >= (tau_cbf - x_i)/dt - f_i,  sum(u) = 0
    """
    u_min = [(tau_cbf - x[i]) / dt - f[i] for i in range(3)]
    u = list(u_des)

    for _ in range(5):
        active = [i for i in range(3) if u[i] < u_min[i]]
        if not active:
            break
        inactive = [i for i in range(3) if i not in active]
        for i in active:
            u[i] = u_min[i]
        current_sum = sum(u)
        if abs(current_sum) < NORMALIZATION_EPSILON:
            break
        if inactive:
            excess_per = current_sum / len(inactive)
            for j in inactive:
                u[j] -= excess_per
        else:
            mean_u = current_sum / 3.0
            u = [ui - mean_u for ui in u]

    return u


def _normalize(x: list[float]) -> tuple[list[float], bool]:
    clamped = [max(0.0, xi) for xi in x]
    total = sum(clamped)
    if total <= NORMALIZATION_EPSILON:
        return [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0], True
    if abs(total - 1.0) < 1e-10:
        return clamped, False
    return [xi / total for xi in clamped], False


# ══════════════════════════════════════════════════════════════════════════════
# Simulation
# ══════════════════════════════════════════════════════════════════════════════

def simulate_cbf(
    *,
    steps: int = 150,
    dt: float = DT_DEFAULT,
    seed: int = 42,
    alpha: float = 0.5,
    cbf_enabled: bool = True,
    input_data: dict | None = None,
    enforce_proof_assertions: bool = False,
) -> dict:
    """
    Full simulation step:
      dx = replicator_dynamics + θ(t)*governor_force + u_basin
      CBF enforcement applied LAST.
    """
    if input_data is None:
        input_data = {}

    rng = random.Random(seed)
    x = [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0]
    theta = THETA_0

    trajectory: list[dict] = []
    theta_traj: list[float] = []
    phi_traj: list[float] = []
    safety_violated = False
    min_m_global = 1.0
    time_below_safe = 0
    recovery_times: list[int] = []
    violation_start: int | None = None
    lyapunov_values: list[float] = []
    delta_v_negative_steps = 0
    delta_v_positive_steps = 0
    delta_v_series: list[float] = []
    invariance_violations = 0

    phi_initial = compute_phi(x, input_data)

    for t in range(steps):
        # ── 1. Intrinsic dynamics (replicator + noise) ──────────────────────
        f = _intrinsic_dynamics(x, rng, alpha)

        if cbf_enabled:
            # ── 2. Governor force ──────────────────────────────────────────
            G = _governor_G(x)
            u_gov = [theta * g for g in G]

            # ── 3. Basin force (safety interaction rule §5) ────────────────
            if min(x) >= MARGIN_SAFETY_CUTOFF:
                u_basin = compute_basin_force(x, input_data)
                # ── 4. Descent guard (§6) ──────────────────────────────────
                phi_prev = compute_phi(x, input_data)
                x_cand_raw = [x[i] + dt * (f[i] + u_gov[i] + u_basin[i]) for i in range(3)]
                x_cand, _ = _normalize(x_cand_raw)
                phi_cand = compute_phi(x_cand, input_data)
                if phi_cand > phi_prev:
                    u_basin = [0.5 * u for u in u_basin]
            else:
                u_basin = [0.0, 0.0, 0.0]

            # ── 5. CBF filter — applied LAST on combined desired control ───
            u_des_combined = [u_gov[i] + u_basin[i] for i in range(3)]
            u_safe = _cbf_safety_filter(x, f, u_des_combined, tau_cbf=TAU_CBF, dt=dt)
            total_force = [f[i] + u_safe[i] for i in range(3)]
        else:
            total_force = f[:]
            u_safe = [0.0, 0.0, 0.0]
            u_basin = [0.0, 0.0, 0.0]

        # ── 6. State update (simplex projection) ────────────────────────────
        x_next = [x[i] + dt * total_force[i] for i in range(3)]
        pre_projection_below_floor = any(v < TAU_CBF for v in x_next)
        x_next, _ = _normalize(x_next)
        if pre_projection_below_floor and any(v < TAU_CBF for v in x_next):
            invariance_violations += 1
        x = x_next

        V_t = lyapunov_candidate(x)
        lyapunov_values.append(V_t)
        delta_V = 0.0 if len(lyapunov_values) == 1 else (lyapunov_values[-1] - lyapunov_values[-2])
        if len(lyapunov_values) > 1:
            delta_v_series.append(delta_V)
            if delta_V < 0:
                delta_v_negative_steps += 1
            elif delta_V > 0:
                delta_v_positive_steps += 1

        M_new = min(x)

        # ── 7. Safety accounting ────────────────────────────────────────────
        if M_new < TAU_CBF - FLOAT_TOLERANCE:
            safety_violated = True
            time_below_safe += 1
            if violation_start is None:
                violation_start = t
        elif violation_start is not None:
            recovery_times.append(t - violation_start)
            violation_start = None

        min_m_global = min(min_m_global, M_new)

        # ── 8. Adaptive gain update ─────────────────────────────────────────
        if cbf_enabled:
            e = max(0.0, TARGET_MARGIN - M_new)
            if e > DEADZONE:
                theta += ALPHA_THETA * e - BETA_THETA * (theta - THETA_0)
                theta = max(THETA_MIN, min(THETA_MAX, theta))

        # ── 9. Logging ──────────────────────────────────────────────────────
        phi_t = compute_phi(x, input_data)
        phi_traj.append(round(phi_t, 6))
        theta_traj.append(theta)

        trajectory.append({
            "t": t,
            "C": round(x[0], 6),
            "R": round(x[1], 6),
            "S": round(x[2], 6),
            "M": round(M_new, 6),
            "theta": round(theta, 6),
            "phi": round(phi_t, 6),
            "basin": identify_basin(x),
            "u_safe": [round(u, 6) for u in u_safe],
            "u_basin": [round(u, 6) for u in u_basin],
            "lyapunov_V": round(V_t, 8),
            "delta_V": round(delta_V, 8),
        })

    if violation_start is not None:
        recovery_times.append(steps - violation_start)

    avg_recovery = sum(recovery_times) / len(recovery_times) if recovery_times else 0.0
    phi_final = phi_traj[-1] if phi_traj else phi_initial
    directional_gain = round(phi_initial - phi_final, 6)
    total_delta_steps = max(1, len(lyapunov_values) - 1)
    corrected_positive_steps = sum(
        1 for i, value in enumerate(delta_v_series[:-1])
        if value > 0 and delta_v_series[i + 1] < 0
    )
    stability_ratio = (delta_v_negative_steps + corrected_positive_steps) / total_delta_steps
    destabilizing_ratio = delta_v_positive_steps / total_delta_steps

    # fix (2026-07-18) — EXCURSION, NOT RAW VALUE: the log-barrier certificate
    # (lyapunov_candidate, above) has a nonzero floor even at the ideal
    # centroid (-log(1/3) ≈ 1.0986 for uniform z), unlike the superseded
    # quadratic candidate's floor of 0. Comparing RAW V against a threshold
    # calibrated for a candidate that starts at 0 is meaningless — raw V now
    # always sits above ~1.0 regardless of actual stability. "Deviation"
    # for any Lyapunov-style certificate with a nonzero interior minimum
    # should mean excursion FROM that minimum (or from V(0)), not the
    # absolute level. Both are reported below; max_deviation (used in
    # fpl1_report, preserving the existing field name/threshold for
    # continuity) is now the excursion from V(0).
    v0 = lyapunov_values[0] if lyapunov_values else 0.0
    vmin = min(lyapunov_values) if lyapunov_values else 0.0
    max_deviation_raw = max(lyapunov_values) if lyapunov_values else 0.0
    max_deviation = max((v - v0) for v in lyapunov_values) if lyapunov_values else 0.0
    classification = (
        "LYAPUNOV STABLE + FORWARD INVARIANT"
        if stability_ratio > 0.6 and invariance_violations == 0 and max_deviation < 0.25
        else "NOT PROVEN"
    )

    if enforce_proof_assertions:
        assert stability_ratio > 0.6
        assert max_deviation < 0.25

    fpl1_report = {
        "stability_ratio": round(stability_ratio, 6),
        "invariance_violations": invariance_violations,
        "max_deviation": round(max_deviation, 8),
        # (2026-07-18) surfaced for audit — NOT part of the classification
        # decision, which still uses max_deviation (now excursion-based)
        # above, unchanged in name/threshold for continuity with prior runs.
        "lyapunov_v0": round(v0, 8),
        "lyapunov_vmin": round(vmin, 8),
        "lyapunov_max_raw": round(max_deviation_raw, 8),
        "classification": classification,
    }
    
    
    

    return {
        "trajectory": trajectory,
        "theta_trajectory": theta_traj,
        "phi_trajectory": phi_traj,
        "min_M": round(min_m_global, 6),
        "safety_violated": safety_violated,
        "time_below_safe": time_below_safe,
        "recovery_times": recovery_times,
        "avg_recovery_time": round(avg_recovery, 3),
        "phi_initial": round(phi_initial, 6),
        "phi_final": round(phi_final, 6),
        "directional_gain": directional_gain,
        "steps": steps,
        "dt": dt,
        "seed": seed,
        "cbf_enabled": cbf_enabled,
        "tau_cbf": TAU_CBF,
        "stability_ratio": round(stability_ratio, 6),
        "delta_v_positive_ratio": round(destabilizing_ratio, 6),
        "max_deviation": round(max_deviation, 8),
        "lyapunov_v0": round(v0, 8),
        "lyapunov_vmin": round(vmin, 8),
        "lyapunov_max_raw": round(max_deviation_raw, 8),
        "invariance_violations": invariance_violations,
        "fpl1_classification": classification,
    }


def simulate_cbf_comparison(
    *,
    steps: int = 150,
    dt: float = DT_DEFAULT,
    seed: int = 42,
    alpha: float = 0.5,
    input_data: dict | None = None,
    enforce_proof_assertions: bool = False,
) -> dict:
    governed = simulate_cbf(steps=steps, dt=dt, seed=seed, alpha=alpha, cbf_enabled=True, input_data=input_data)
    ungoverned = simulate_cbf(steps=steps, dt=dt, seed=seed, alpha=alpha, cbf_enabled=False, input_data=input_data)
    return {
        "governed": governed,
        "ungoverned": ungoverned,
        "safety_guarantee_holds": not governed["safety_violated"],
        "improvement_min_M": round(governed["min_M"] - ungoverned["min_M"], 6),
    }
