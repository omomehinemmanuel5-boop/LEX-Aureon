# Governance Observatory Events

This document defines the live event contract for the existing Governance Console.

## Event types
- receipt_generated
- trajectory_stabilized
- benchmark_verified

## Payload

```ts
interface GovernanceEvent {
  type: 'receipt_generated' | 'trajectory_stabilized' | 'benchmark_verified';
  benchmark?: string;
  run?: string;
  commit?: string;
  workflow?: string;
  receiptHash?: string;
  timestamp: string;
}
```

The console's GovernanceFeed should consume this schema so future runtime events, benchmark receipts, and verification events share one typed stream.
