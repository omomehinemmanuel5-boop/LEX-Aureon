/**
 * Deterministic red-team smoke suite for the Lex reference monitor.
 *
 * This is intentionally local and dependency-light. It validates governance
 * invariants without invoking real external systems or provider APIs.
 */
import {
  getToolCapability,
  isKnownGovernedTool,
  requireKnownToolCapability,
} from '../lib/agents/tool_capability_registry';
import {
  classifyGovernanceRisk,
  hashGovernanceArguments,
} from '../lib/agents/tool_governance_gateway';

type Case = {
  id: string;
  tool: string;
  expectedKnown: boolean;
  expectedRisk?: string;
};

const cases: Case[] = [
  { id:'RT-001', tool:'read_file', expectedKnown:true, expectedRisk:'read' },
  { id:'RT-002', tool:'write_file', expectedKnown:true, expectedRisk:'write' },
  { id:'RT-003', tool:'dispatch_workflow', expectedKnown:true, expectedRisk:'external' },
  { id:'RT-004', tool:'delete_repository', expectedKnown:true, expectedRisk:'destructive' },
  { id:'RT-005', tool:'mystery_side_effect', expectedKnown:false },
  { id:'RT-006', tool:'unknown_payment_tool', expectedKnown:false },
];

let failures = 0;

for (const test of cases) {
  const known = isKnownGovernedTool(test.tool);
  if (known !== test.expectedKnown) {
    failures++;
    console.error(`FAIL ${test.id}: known=${known}, expected=${test.expectedKnown}`);
    continue;
  }

  if (test.expectedRisk && classifyGovernanceRisk(test.tool) !== test.expectedRisk) {
    failures++;
    console.error(
      `FAIL ${test.id}: risk=${classifyGovernanceRisk(test.tool)}, expected=${test.expectedRisk}`,
    );
    continue;
  }

  if (!known) {
    try {
      requireKnownToolCapability(test.tool);
      failures++;
      console.error(`FAIL ${test.id}: unknown tool was not fail-closed`);
    } catch {
      // expected
    }
  } else {
    const capability = getToolCapability(test.tool);
    if (!capability) {
      failures++;
      console.error(`FAIL ${test.id}: registry lookup returned no capability`);
    }
  }

  const stable = hashGovernanceArguments({ z:1, a:2 }) === hashGovernanceArguments({ a:2, z:1 });
  if (!stable) {
    failures++;
    console.error(`FAIL ${test.id}: argument hash is not canonical`);
  }
}

console.log(`Lex governance red-team smoke: ${cases.length - failures}/${cases.length} cases passed`);
if (failures) process.exit(1);
