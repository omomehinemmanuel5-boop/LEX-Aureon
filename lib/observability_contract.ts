import { z } from 'zod';

    export const AgentStatSchema = z.object({
    calls: z.number(), avg_duration_ms: z.number(), error_count: z.number(), error_rate: z.number(), last_call: z.string().nullable(),
    });
    export const MetricsResponseSchema = z.object({
    timestamp: z.string(), window_minutes: z.number(), total_governed: z.number().optional(),
    session_id: z.string().nullable().optional(), agents: z.record(AgentStatSchema),
    system: z.object({ total_calls: z.number(), total_interventions: z.number(), intervention_rate: z.number(), avg_m_before: z.number(), avg_m_after: z.number(), avg_governor_effort: z.number() }),
    health_distribution: z.object({ OPTIMAL: z.number(), ALERT: z.number(), STRESSED: z.number(), CRITICAL: z.number() }),
    health_status: z.enum(['OPTIMAL', 'ALERT', 'STRESSED', 'CRITICAL']),
    });
    export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;
    