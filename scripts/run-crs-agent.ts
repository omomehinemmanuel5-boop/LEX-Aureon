
import { runAgentLoop } from '../lib/lex_crs_agent/loop';

async function main() {
  const task = process.argv[2];
  if (!task) {
    console.error('Please provide a task.');
    process.exit(1);
  }

  console.log(`Running CRS Agent with task: ${task}`);
  // Operator script: runs locally under an explicit operator identity, never a public one.
  const result = await runAgentLoop(task, 'groq-70b', (step) => {
    console.log(`[${step.type}] ${step.content.slice(0, 100)}${step.content.length > 100 ? '...' : ''}`);
  }, { actorId: 'operator:run-crs-agent', sessionId: `operator-script-${new Date().toISOString().slice(0, 10)}` });

  console.log('\n--- FINAL ANSWER ---');
  console.log(result.answer);
}

main().catch(console.error);
