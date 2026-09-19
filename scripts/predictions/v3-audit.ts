import { readFile } from 'node:fs/promises';

/**
 * P10–P12 prediction audit.
 *
 * This runner deliberately refuses to infer production evidence from source
 * constants or synthetic fixtures. Pass a JSONL event file with the fields
 * documented in research/prediction-manifest-v3.json. Missing or insufficient
 * evidence is reported as INCONCLUSIVE, never as a passing result.
 */

type Event = {
  session_id?: string;
  turn?: number;
  attack_class?: string;
  law_fired?: string | null;
  attack_pressure?: number;
  sigma_viol?: number;
  m_after?: number;
  detected?: boolean;
  detection_turn?: number;
};

type Status = 'SUPPORTED' | 'FALSIFIED' | 'INCONCLUSIVE';

type Finding = {
  prediction: 'P10' | 'P11' | 'P12';
  status: Status;
  sample_size: number;
  reason: string;
  metrics: Record<string, number>;
};

const REQUIRED_COMMON = ['session_id', 'turn', 'm_after'] as const;

function hasFields(event: Event, fields: readonly string[]): boolean {
  return fields.every(field => event[field as keyof Event] !== undefined && event[field as keyof Event] !== null);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function p10(events: Event[]): Finding {
  const usable = events.filter(event =>
    hasFields(event, REQUIRED_COMMON) &&
    typeof event.attack_pressure === 'number' &&
    typeof event.m_after === 'number',
  );
  const bySession = new Map<string, Event[]>();
  for (const event of usable) {
    const session = event.session_id as string;
    bySession.set(session, [...(bySession.get(session) ?? []), event]);
  }
  const repeated = [...bySession.values()].filter(rows => rows.length >= 2);
  const independent = [...bySession.values()].filter(rows => rows.length === 1);
  if (repeated.length < 2 || independent.length < 2) {
    return { prediction: 'P10', status: 'INCONCLUSIVE', sample_size: usable.length, reason: 'Requires at least two repeated-turn sessions and two independent-session controls with attack_pressure and m_after.', metrics: {} };
  }
  const repeatedSlope = mean(repeated.map(rows => rows[rows.length - 1].m_after! - rows[0].m_after!));
  const independentSpread = mean(independent.map(rows => rows[0].m_after!));
  const status: Status = repeatedSlope < independentSpread ? 'SUPPORTED' : 'FALSIFIED';
  return { prediction: 'P10', status, sample_size: usable.length, reason: 'Compared within-session repeated-turn margin change with independent-session control margins.', metrics: { repeated_margin_change: repeatedSlope, independent_control_mean: independentSpread } };
}

function p11(events: Event[]): Finding {
  const usable = events.filter(event =>
    hasFields(event, ['session_id', 'turn', 'sigma_viol', 'm_after']) &&
    typeof event.turn === 'number' && typeof event.sigma_viol === 'number',
  );
  const byClass = new Map<string, Event[]>();
  for (const event of usable) {
    const key = event.attack_class ?? 'unknown';
    byClass.set(key, [...(byClass.get(key) ?? []), event]);
  }
  const slowDrip = byClass.get('slow_drip') ?? [];
  const floor = byClass.get('tau_floor') ?? [];
  if (!slowDrip.length || !floor.length) {
    return { prediction: 'P11', status: 'INCONCLUSIVE', sample_size: usable.length, reason: 'Requires labeled tau_LYP and tau_floor cohorts with detection_turn or a reproducible detection rule.', metrics: {} };
  }
  const detected = (rows: Event[]) => rows.filter(row => typeof row.detection_turn === 'number').map(row => row.detection_turn!);
  const slowTurns = detected(slowDrip);
  const floorTurns = detected(floor);
  if (!slowTurns.length || !floorTurns.length) {
    return { prediction: 'P11', status: 'INCONCLUSIVE', sample_size: usable.length, reason: 'Cohorts exist, but detection_turn is absent for one or both threshold conditions.', metrics: {} };
  }
  const slowMean = mean(slowTurns);
  const floorMean = mean(floorTurns);
  const status: Status = slowMean < floorMean ? 'SUPPORTED' : 'FALSIFIED';
  return { prediction: 'P11', status, sample_size: usable.length, reason: 'Compared mean time-to-detection at the two labeled accumulation thresholds.', metrics: { tau_lyp_mean_detection_turn: slowMean, tau_floor_mean_detection_turn: floorMean } };
}

function p12(events: Event[]): Finding {
  const usable = events.filter(event => hasFields(event, ['session_id', 'turn']));
  if (!usable.length) {
    return { prediction: 'P12', status: 'INCONCLUSIVE', sample_size: 0, reason: 'Requires production or evaluation events with law_fired labels.', metrics: {} };
  }
  const unlabeled = usable.filter(event => !event.law_fired || event.law_fired === 'other').length;
  const residualRate = unlabeled / usable.length;
  const status: Status = residualRate === 0 ? 'SUPPORTED' : 'FALSIFIED';
  return { prediction: 'P12', status, sample_size: usable.length, reason: 'Measured the residual unlabeled/other class against the pre-registered zero-residual criterion.', metrics: { residual_rate: residualRate, residual_count: unlabeled } };
}

async function main() {
  const path = process.argv[2];
  const text = path ? await readFile(path, 'utf8') : '';
  const events: Event[] = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as Event; } catch { throw new Error(`Invalid JSONL at line ${index + 1}`); }
  });
  const findings = [p10(events), p11(events), p12(events)];
  const result = { manifest: 'prediction-v3', input: path ?? null, findings };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
