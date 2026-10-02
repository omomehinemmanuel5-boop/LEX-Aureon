import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadKernelState: vi.fn(),
  loadKernelZ: vi.fn(),
  writeKernelReceipt: vi.fn(),
  incrementRuns: vi.fn(),
  embedTextResolved: vi.fn(),
  embedTextWithProvider: vi.fn(),
  retrieveSimilar: vi.fn(),
  retrieveSessionHistory: vi.fn(),
  storeMemory: vi.fn(),
  getConstitutionalCentroid: vi.fn(),
  getSessionCentroid: vi.fn(),
  getHarmReferenceCentroid: vi.fn(),
  getBenignReferenceCentroid: vi.fn(),
  judgeCapitulation: vi.fn(),
  persistCapitulationCalibration: vi.fn(),
  CelesteAgent: vi.fn(),
  StyleAgent: vi.fn(),
  fireGovernorLoop: vi.fn(),
  consumePendingCorrection: vi.fn(),
  generateGoverned: vi.fn(),
  getLawImpact: vi.fn(),
}));

vi.mock('../lib/kernel_bridge', () => ({
  loadKernelState: mocks.loadKernelState,
  loadKernelZ: mocks.loadKernelZ,
  writeKernelReceipt: mocks.writeKernelReceipt,
}));
vi.mock('../lib/db', () => ({ incrementRuns: mocks.incrementRuns }));
vi.mock('../lib/lex_memory', () => ({
  embedTextResolved: mocks.embedTextResolved,
  embedTextWithProvider: mocks.embedTextWithProvider,
  retrieveSimilar: mocks.retrieveSimilar,
  retrieveSessionHistory: mocks.retrieveSessionHistory,
  buildMemoryContext: vi.fn(() => ''),
  buildSessionContext: vi.fn(() => ''),
  storeMemory: mocks.storeMemory,
  classifyStateLabel: vi.fn(() => 'neutral'),
  getConstitutionalCentroid: mocks.getConstitutionalCentroid,
  getSessionCentroid: mocks.getSessionCentroid,
  getHarmReferenceCentroid: mocks.getHarmReferenceCentroid,
  getBenignReferenceCentroid: mocks.getBenignReferenceCentroid,
  cosineSimilarity: vi.fn(() => 0),
}));
vi.mock('../lib/capitulation_judge', () => ({ judgeCapitulation: mocks.judgeCapitulation }));
vi.mock('../lib/capitulation_calibration', () => ({ persistCapitulationCalibration: mocks.persistCapitulationCalibration }));
vi.mock('../lib/agents/celeste', () => ({ CelesteAgent: mocks.CelesteAgent }));
vi.mock('../lib/agents/style_agent', () => ({ StyleAgent: mocks.StyleAgent }));
vi.mock('../lib/governor_loop', () => ({
  fireGovernorLoop: mocks.fireGovernorLoop,
  consumePendingCorrection: mocks.consumePendingCorrection,
}));
vi.mock('../lib/llm_provider', () => ({ generateGoverned: mocks.generateGoverned }));
vi.mock('../lib/kv', () => ({ getLawImpact: mocks.getLawImpact }));

import { executeGovern } from '../lib/governance_service';
import { clearKernelCacheForTests, getCachedKernel } from '../lib/kernel_cache';

describe('governance simulation isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKernelCacheForTests();
  });

  it('uses a fresh neutral kernel and performs no provider, database, correction, or persistence work', async () => {
    const sessionId = 'simulation-isolation-session';
    const cached = getCachedKernel(sessionId);
    cached.state = { C: 0.2, R: 0.3, S: 0.5 };
    cached.step_counter = 7;
    const beforeState = { ...cached.state };

    const response = await executeGovern({
      prompt: 'Summarize the repository governance design.',
      session_id: sessionId,
      turn: 1,
      identity_mode: 'full',
      governance_mode: 'simulate',
    });

    expect(getCachedKernel(sessionId)).toBe(cached);
    expect(cached.state).toEqual(beforeState);
    expect(cached.step_counter).toBe(7);
    expect(response.governance_mode).toBe('simulate');
    expect(response.crs_source).toBe('typescript-kernel-simulation');
    expect(response.simulation_notice).toContain('LOCAL SIMULATION ONLY');
    expect(response.receipt_persisted).toBe(false);
    expect(response.receipt_id).toBeNull();
    expect(response.raw_provider).toBe('not_called');
    expect(response.governed_provider).toBe('not_called');

    for (const fn of [
      mocks.loadKernelState, mocks.loadKernelZ, mocks.writeKernelReceipt, mocks.incrementRuns,
      mocks.embedTextResolved, mocks.embedTextWithProvider, mocks.retrieveSimilar,
      mocks.retrieveSessionHistory, mocks.storeMemory, mocks.getConstitutionalCentroid,
      mocks.getSessionCentroid, mocks.getHarmReferenceCentroid, mocks.getBenignReferenceCentroid,
      mocks.judgeCapitulation, mocks.persistCapitulationCalibration, mocks.CelesteAgent,
      mocks.StyleAgent, mocks.fireGovernorLoop, mocks.consumePendingCorrection, mocks.generateGoverned,
      mocks.getLawImpact,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
