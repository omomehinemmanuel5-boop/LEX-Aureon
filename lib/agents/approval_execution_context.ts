import { AsyncLocalStorage } from 'node:async_hooks';

export interface ConsumedApprovalContext {
  requestId: string;
  ownerId: string;
  sessionId: string;
  toolName: string;
  argsHash: string;
}

const context = new AsyncLocalStorage<ConsumedApprovalContext>();

export function withConsumedApproval<T>(
  approval: ConsumedApprovalContext,
  operation: () => Promise<T>,
): Promise<T> {
  return context.run(approval, operation);
}

export function currentConsumedApproval(): ConsumedApprovalContext | undefined {
  return context.getStore();
}
