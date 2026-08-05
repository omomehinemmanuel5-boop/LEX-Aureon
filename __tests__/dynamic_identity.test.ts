import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SovereignKernel, type IdentityMode } from '../lib/sovereign_kernel';
import * as codebaseSummary from '../lib/codebase_summary';
import * as capabilityDiscovery from '../lib/capability_discovery';
import * as llmProvider from '../lib/llm_provider';

vi.mock('../lib/llm_provider', () => ({
  generateGoverned: vi.fn().mockResolvedValue({ text: 'mocked response', provider: 'mock', model: 'mock' }),
  MODELS: {
    PRIMARY: 'mock-primary',
    FAST: 'mock-fast',
    GEMINI_FULL: 'mock-gemini',
  }
}));

vi.mock('../lib/lex_memory', () => ({
  embedTextResolved: vi.fn().mockResolvedValue(new Float32Array(1536)),
  embedTextWithProvider: vi.fn().mockResolvedValue(new Float32Array(1536)),
  cosineSimilarity: vi.fn().mockReturnValue(0),
}));

describe('Dynamic Identity', () => {
  let kernel: SovereignKernel;

  beforeEach(() => {
    kernel = new SovereignKernel();
    vi.clearAllMocks();
  });

  it('injects codebase and capability summaries in dynamic mode', async () => {
    const codebaseSpy = vi.spyOn(codebaseSummary, 'getCodebaseSummary').mockReturnValue('Mock Codebase Summary');
    const capabilitiesSpy = vi.spyOn(capabilityDiscovery, 'getCapabilitiesSummary').mockReturnValue('Mock Capabilities Summary');
    const detailedSpy = vi.spyOn(capabilityDiscovery, 'getDetailedCapabilities').mockReturnValue('- tool1: desc1');

    const mode: IdentityMode = 'dynamic';
    await kernel.runCycle('Who are you?', '', 'test-session', undefined, 0, mode);

    expect(codebaseSpy).toHaveBeenCalled();
    expect(capabilitiesSpy).toHaveBeenCalled();
    expect(detailedSpy).toHaveBeenCalled();

    const callLLMSpy = vi.spyOn(kernel, 'callLLM');
    // Note: Since we are testing runCycle which calls callLLM, we can check the arguments passed to generateGoverned
    const generateSpy = llmProvider.generateGoverned as unknown as { mock: { calls: Array<Array<Array<{ role: string; content: string }>>> } };
    
    // generateGoverned is called twice: once for raw, once for governed
    // The governed call is the one with the system message
    const governedCall = generateSpy.mock.calls.find(call => call[0].some(m => m.role === 'system'));
    if (!governedCall) throw new Error('Governed call not found');
    const systemMessage = governedCall[0].find(m => m.role === 'system');
    if (!systemMessage) throw new Error('System message not found');
    
    expect(systemMessage.content).toContain('Mock Codebase Summary');
    expect(systemMessage.content).toContain('Mock Capabilities Summary');
    expect(systemMessage.content).toContain('- tool1: desc1');
    expect(systemMessage.content).toContain('Live constitutional state');
  });
});
