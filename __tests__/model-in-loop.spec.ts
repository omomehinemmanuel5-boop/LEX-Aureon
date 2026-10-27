import { describe, expect, it } from 'vitest';
import { parseToolPlan } from '../scripts/agentdojo-real/model-in-loop';

describe('model-in-the-loop evaluation plan parser', () => {
  it('accepts plain and fenced JSON tool plans', () => {
    expect(parseToolPlan('[{"name":"read_file","arguments":{"path":"config.md"}}]')).toEqual([
      { name: 'read_file', arguments: { path: 'config.md' } },
    ]);
    expect(parseToolPlan('```json\n[{"name":"list_files","arguments":{}}]\n```')).toEqual([
      { name: 'list_files', arguments: {} },
    ]);
    expect(parseToolPlan('{"calls":[{"name":"list_files","arguments":{}}]}')).toEqual([
      { name: 'list_files', arguments: {} },
    ]);
  });

  it('rejects prose, malformed calls, and oversized plans', () => {
    expect(parseToolPlan('I will read the file first.')).toBeNull();
    expect(parseToolPlan('[{"name":"read_file"}]')).toBeNull();
    const tooMany = Array.from({ length: 13 }, () => ({ name: 'list_files', arguments: {} }));
    expect(parseToolPlan(JSON.stringify(tooMany))).toBeNull();
  });
});
