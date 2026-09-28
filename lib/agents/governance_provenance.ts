import crypto from 'crypto';

export interface GovernanceProvenanceEvent {
  eventId: string;
  timestamp: number;
  actorId: string;
  sessionId: string;
  toolName: string;
  argsHash: string;
  policyVersion: string;
  decision: string;
  authorizationId?: string;
  previousHash?: string;
}

function canonical(event: GovernanceProvenanceEvent): string {
  return JSON.stringify(Object.fromEntries(Object.entries(event).sort(([a],[b]) => a.localeCompare(b))));
}

export function hashProvenanceEvent(event: GovernanceProvenanceEvent): string {
  return crypto.createHash('sha256').update(canonical(event)).digest('hex');
}

export function appendProvenanceEvent(
  event: Omit<GovernanceProvenanceEvent, 'previousHash'>,
  previousHash?: string,
): GovernanceProvenanceEvent {
  return previousHash ? { ...event, previousHash } : { ...event };
}

export function verifyProvenanceChain(events: GovernanceProvenanceEvent[]): boolean {
  let previous: string | undefined;
  for (const event of events) {
    if (event.previousHash !== previous) return false;
    previous = hashProvenanceEvent(event);
  }
  return true;
}
