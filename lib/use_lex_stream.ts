'use client';

import { useCallback, useRef, useState } from 'react';
import type { GovernanceResponse } from '@/types/governance-types';

export interface StreamState {
  loading: boolean;
  error: string | null;
  stage: 'idle' | 'pre_eval' | 'memory' | 'memory_injected' | 'generating' | 'raw_forge' | 'measuring' | 'governing' | 'intervening' | 'neithra' | 'clause_bank' | 'vaulturex' | 'celeste' | 'style_agent' | 'self_referential' | 'auditing' | 'complete';
  preEval: { label: string; governor_mode: string; blocked: boolean; tags?: string[] } | null;
  partialOutput: string;
  metrics: { c: number; r: number; s: number; m: number; health?: string; health_band?: string } | null;
  intervention: { triggered: boolean; applied: boolean; action?: string; weakest?: string; severity?: string; law_invoked?: { id?: number; name: string; book: string; pillar: string; }; output_modified?: boolean; } | null;
  governor: { decision: string; dV: number; lyapunov_stable: boolean; V_before: number; V_after: number; weakest: string; reason: string } | null;
  law: { id?: number; book: string; name: string; pillar: string; } | null;
  selfReferential: { sovereignty_raw?: number; sovereignty_violated?: boolean; fired?: boolean; } | null;
  rawOutput: string | null;
  auditId: string | null;
  neithra: { approved: boolean; alignment_verified: boolean; re_routed: boolean; final_law_id: number | null; rationale: string; jurisprudence: string; } | null;
  clauseBank: { found: boolean; clause_id: string; clause_text: string; reference: string; topic: string; layer: number; jurisdiction: string; governor_use: string; } | null;
  vaulturex: { compliant: boolean; risk_level: string; flags: string[]; compliance_receipt: string; } | null;
  celeste: { format: string; seal_applied: boolean; template: string; } | null;
  styleAgent: { cleaned_length: number; original_length: number; } | null;
  complete: GovernanceResponse | null;
  kernelMode: boolean;
  stageDescription: string | null;
}

const INITIAL: StreamState = {
  loading: false,
  error: null,
  stage: 'idle',
  preEval: null,
  partialOutput: '',
  metrics: null,
  intervention: null,
  governor: null,
  law: null,
  selfReferential: null,
  rawOutput: null,
  auditId: null,
  neithra: null,
  clauseBank: null,
  vaulturex: null,
  celeste: null,
  styleAgent: null,
  complete: null,
  kernelMode: false,
  stageDescription: null,
};

export function useLexStream() {
  const [state, setState] = useState<StreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => setState(INITIAL), []);

  const run = useCallback(async (prompt: string, sessionId: string, useKernel = true) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Default: SovereignKernel stream. Fallback: PRAXIS stream.
    const endpoint = useKernel
      ? '/api/lex/govern/stream'
      : '/api/lex/govern/stream';

    setState({ ...INITIAL, loading: true, stage: 'pre_eval', kernelMode: useKernel });

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        let msg = `Error ${res.status}`;
        try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* keep */ }
        throw new Error(msg);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          if (!frame.trim() || frame.startsWith(':')) continue;
          const lines = frame.split('\n');
          let event = 'message', data = '';
          for (const line of lines) {
            if (line.startsWith('event:'))     event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { continue; }
          handleEvent(event, parsed, setState);
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Stream failed', stage: 'idle' }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, loading: false, stage: 'idle' }));
  }, []);

  return { state, run, reset, cancel };
}

function handleEvent(
  event: string,
  data: unknown,
  setState: React.Dispatch<React.SetStateAction<StreamState>>,
) {
  switch (event) {
    case 'pre_eval':
      setState((s) => ({ ...s, preEval: data as StreamState['preEval'] }));
      break;
    case 'stage': {
      const sd = data as { name: string; description?: string };
      setState((s) => ({ ...s, stage: (sd.name as StreamState['stage']) ?? s.stage, stageDescription: sd.description ?? null }));
      break;
    }
    case 'token':
      setState((s) => ({ ...s, partialOutput: s.partialOutput + (data as string) }));
      break;
    case 'raw':
      setState((s) => ({ ...s, rawOutput: (data as { output: string }).output }));
      break;
    case 'crs':
      setState((s) => ({ ...s, metrics: data as StreamState['metrics'] }));
      break;
    case 'governor':
      setState((s) => ({ ...s, governor: data as StreamState['governor'] }));
      break;
    case 'law':
      setState((s) => ({ ...s, law: data as StreamState['law'] }));
      break;
    case 'self_referential':
      setState((s) => ({ ...s, selfReferential: data as StreamState['selfReferential'] }));
      break;
    case 'intervention': {
      const iv = data as StreamState['intervention'];
      setState((s) => ({
        ...s,
        intervention: iv,
        partialOutput: iv?.output_modified && iv.governed_output ? iv.governed_output : s.partialOutput,
      }));
      break;
    }
    case 'receipt':
      setState((s) => ({ ...s, auditId: (data as { audit_id: string }).audit_id }));
      break;
    case 'complete':
      setState((s) => ({ ...s, loading: false, complete: data as GovernanceResponse }));
      break;
    case 'error':
      setState((s) => ({ ...s, loading: false, error: (data as { error: string }).error || 'Stream failed' }));
      break;
    case 'neithra':
      setState((s) => ({ ...s, neithra: data as StreamState['neithra'] }));
      break;
    case 'clause_bank':
      setState((s) => ({ ...s, clauseBank: data as StreamState['clauseBank'] }));
      break;
    case 'vaulturex':
      setState((s) => ({ ...s, vaulturex: data as StreamState['vaulturex'] }));
      break;
    case 'celeste':
      setState((s) => ({ ...s, celeste: data as StreamState['celeste'] }));
      break;
    case 'style_agent':
      setState((s) => ({ ...s, styleAgent: data as StreamState['styleAgent'] }));
      break;
  }
}
