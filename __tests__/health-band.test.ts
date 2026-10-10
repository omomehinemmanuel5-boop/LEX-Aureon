import { describe, expect, it } from 'vitest';
import { healthBand } from '../lib/health_band';

describe('canonical health-band thresholds', () => {
  it('uses the constitutional floor, not the Lyapunov penalty threshold, for CRITICAL', () => {
    expect(healthBand(0.0499)).toBe('CRITICAL');
    expect(healthBand(0.05)).toBe('STRESSED');
    expect(healthBand(0.0799)).toBe('STRESSED');
    expect(healthBand(0.08)).toBe('STRESSED');
  });

  it('preserves the recovery and optimal boundaries', () => {
    expect(healthBand(0.1499)).toBe('STRESSED');
    expect(healthBand(0.15)).toBe('ALERT');
    expect(healthBand(0.2499)).toBe('ALERT');
    expect(healthBand(0.25)).toBe('OPTIMAL');
  });
});
