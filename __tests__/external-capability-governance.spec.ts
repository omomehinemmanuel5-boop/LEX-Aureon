import { describe, expect, it } from 'vitest';
import { resolveToolManifest } from '../lib/agents/tool_capability_discovery';

describe('external capability governance boundary', () => {
  it('discovers a write tool conservatively without granting execution authority', () => {
    const capability = resolveToolManifest('test-env', {
      name: 'edit_customer_record',
      description: 'Update a customer record',
      inputSchema: { type: 'object', properties: { record: { type: 'object' } } },
    });

    expect(capability.capability).toBe('write');
    expect(capability.approvalRequired).toBe(true);
    expect(capability.source).toBe('extension');
  });

  it('discovers read-only tools as non-consequential capabilities', () => {
    const capability = resolveToolManifest('test-env', {
      name: 'lookup_customer',
      description: 'Read customer profile',
      annotations: { readOnlyHint: true },
    });

    expect(capability.capability).toBe('read');
    expect(capability.approvalRequired).toBe(false);
  });

  it('keeps arbitrary execution classified as highest-risk', () => {
    const capability = resolveToolManifest('test-env', {
      name: 'run_command',
      description: 'Execute a shell command',
    });

    expect(capability.capability).toBe('execute');
    expect(capability.approvalRequired).toBe(true);
    expect(capability.reversible).toBe(false);
  });
});
