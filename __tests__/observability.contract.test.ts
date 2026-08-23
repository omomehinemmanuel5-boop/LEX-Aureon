import { describe, expect, it } from 'vitest';
    import { MetricsResponseSchema } from '@/lib/observability_contract';

    describe('observability response contract', () => {
    it('accepts the live metrics shape', () => {
      const parsed = MetricsResponseSchema.parse({ timestamp: new Date().toISOString(), window_minutes: 60, session_id: null, agents: {}, system: { total_calls: 2, total_interventions: 1, intervention_rate: 0.5, avg_m_before: 0.2, avg_m_after: 0.1, avg_governor_effort: 0.3 }, health_distribution: { OPTIMAL: 0, ALERT: 1, STRESSED: 1, CRITICAL: 0 }, health_status: 'STRESSED' });
      expect(parsed.system.total_calls).toBe(2);
    });
    it('rejects undefined metric values instead of rendering them', () => {
      expect(() => MetricsResponseSchema.parse({ agents: {}, system: {} })).toThrow();
    });
    });
    