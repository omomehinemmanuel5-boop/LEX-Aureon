'use client';

    import { useEffect, useState } from 'react';
    import GovernanceStateBar from './GovernanceStateBar';

    type LiveStateResponse = {
    state: { C: number | null; R: number | null; S: number | null; M: number | null };
    total_runs: number;
    };

    export default function LiveGovernanceState() {
    const [data, setData] = useState<LiveStateResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
      let mounted = true;
      const load = async () => {
        try {
          const response = await fetch('/api/live-state');
          if (!response.ok) throw new Error('live-state request failed');
          const next = await response.json() as LiveStateResponse;
          if (mounted) { setData(next); setError(false); }
        } catch {
          if (mounted) setError(true);
        } finally {
          if (mounted) setLoading(false);
        }
      };
      load();
      const interval = setInterval(load, 60_000);
      return () => { mounted = false; clearInterval(interval); };
    }, []);

    if (loading && !data) {
      return <div className="rounded-xl border p-4 bg-background/60 text-sm opacity-70">Syncing live constitutional state…</div>;
    }
    if (error && !data) {
      return <div className="rounded-xl border p-4 bg-background/60 text-sm text-amber-500">Live constitutional state is temporarily unavailable.</div>;
    }

    const state = data?.state;
    if (!state || state.C === null || state.R === null || state.S === null || state.M === null) {
      return <div className="rounded-xl border p-4 bg-background/60 text-sm opacity-70">No session data yet — the simulator has not produced a z_traj state.</div>;
    }

    // Asserted mapping, not verified against a formal spec: the API's C/R/S/M
    // names are mapped to GovernanceStateBar's descriptive prop names.
    // governorMode is intentionally omitted: /api/live-state does not expose it,
    // and this surface must not invent a mode or fetch an unrelated value.
    return <GovernanceStateBar continuity={state.C} reciprocity={state.R} sovereignty={state.S} stabilityMargin={state.M} />;
    }
    