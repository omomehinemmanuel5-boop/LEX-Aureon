import { AsyncLocalStorage } from 'async_hooks';

/**
 * Carries the server-assigned run ID through the async call chain of one agent
 * run, so every receipt written during that run can be correlated to it. The ID
 * is set once by the run entry point and cannot be changed by model output.
 */
const runStore = new AsyncLocalStorage<{ runId: string }>();

export function runWithRunId<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return runStore.run({ runId }, fn);
}

export function currentRunId(): string | null {
  return runStore.getStore()?.runId ?? null;
}
