import { describe, expect, it } from 'vitest';
import { appendProvenanceEvent, hashProvenanceEvent, verifyProvenanceChain } from '@/lib/agents/governance_provenance';

describe('governance provenance chain', () => {
  it('chains events without storing raw arguments', () => {
    const first = appendProvenanceEvent({
      eventId:'e1', timestamp:1, actorId:'agent', sessionId:'s1', toolName:'write_file',
      argsHash:'a1', policyVersion:'p1', decision:'approval_required',
    });
    const second = appendProvenanceEvent({
      eventId:'e2', timestamp:2, actorId:'agent', sessionId:'s1', toolName:'write_file',
      argsHash:'a2', policyVersion:'p1', decision:'allow', authorizationId:'ap-1',
    }, hashProvenanceEvent(first));
    expect(verifyProvenanceChain([first, second])).toBe(true);
    expect(JSON.stringify(first)).not.toContain('raw');
  });

  it('detects tampering or reordering', () => {
    const a = appendProvenanceEvent({eventId:'a',timestamp:1,actorId:'x',sessionId:'s',toolName:'read_file',argsHash:'1',policyVersion:'p',decision:'allow'});
    const b = appendProvenanceEvent({eventId:'b',timestamp:2,actorId:'x',sessionId:'s',toolName:'read_file',argsHash:'2',policyVersion:'p',decision:'allow'},hashProvenanceEvent(a));
    expect(verifyProvenanceChain([a,b])).toBe(true);
    expect(verifyProvenanceChain([b,a])).toBe(false);
  });
});
