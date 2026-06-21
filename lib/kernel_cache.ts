import { SovereignKernel } from './sovereign_kernel';

export type KernelStateSnapshot = { C: number; R: number; S: number };

export const MAX_KERNEL_CACHE_ENTRIES = 750;

const kernelCache = new Map<string, SovereignKernel>();

export function getCachedKernel(
  sessionId: string,
  savedState?: KernelStateSnapshot | null,
): SovereignKernel {
  const cached = kernelCache.get(sessionId);
  if (cached) {
    kernelCache.delete(sessionId);
    kernelCache.set(sessionId, cached);
    return cached;
  }

  const kernel = new SovereignKernel();
  if (savedState) kernel.state = savedState;
  kernelCache.set(sessionId, kernel);

  if (kernelCache.size > MAX_KERNEL_CACHE_ENTRIES) {
    const oldestSessionId = kernelCache.keys().next().value as string | undefined;
    if (oldestSessionId !== undefined) kernelCache.delete(oldestSessionId);
  }

  return kernel;
}

export function getKernelCacheSize(): number {
  return kernelCache.size;
}

export function clearKernelCacheForTests(): void {
  kernelCache.clear();
}
