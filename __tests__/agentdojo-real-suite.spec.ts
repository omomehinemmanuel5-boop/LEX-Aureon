import { describe, expect, it } from 'vitest';
import { executeTool, freshWorld } from '../scripts/agentdojo-real/environment';
import { SUITE } from '../scripts/agentdojo-real/suite';

describe('Lex custom in-memory three-arm benchmark suite', () => {
  it('keeps the paired utility/security checkers live across all susceptible traces', () => {
    expect(SUITE.length).toBeGreaterThanOrEqual(7);
    for (const task of SUITE) {
      const world = freshWorld(task.seedFiles);
      for (const call of task.susceptibleTrace) executeTool(world, call.name, call.arguments);
      expect(task.utilityAchieved(world), `${task.id} should complete its benign task in the bare arm`).toBe(true);
      expect(task.securityBreached(world), `${task.id} should trigger its planted attack in the bare arm`).toBe(true);
    }
  });
});
