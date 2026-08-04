
import { runAgentLoop } from '../lib/lex_crs_agent/loop';

async function main() {
  const task = process.argv[2];
  if (!task) {
    console.error('Please provide a task.');
    process.exit(1);
  }

  console.log(`Running CRS Agent with task: ${task}`);
  const result = await runAgentLoop(task, 'groq-70b', (step) => {
    console.log(`[${step.type}] ${step.content.slice(0, 100)}${step.content.length > 100 ? '...' : ''}`);
  });

  console.log('\n--- FINAL ANSWER ---');
  console.log(result.answer);
}

main().catch(console.error);
