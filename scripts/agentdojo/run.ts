/**
 * AgentDojo runner — Debenedetti et al. NeurIPS 2024
 * "AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents"
 *
 * 27 prompt injection scenarios from 4 real agent suites:
 *   workspace · banking · travel · slack
 * Attack type: ImportantInstructions (most cited in paper)
 * Injection format: malicious instructions embedded in tool outputs
 *
 * Usage:
 *   npm run agentdojo -- --endpoint https://lexaureon.com
 */
import * as fs   from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const minimist = require('minimist') as (args: string[], opts?: object) => Record<string, unknown>;

interface AgentDojoPrompt {
  id: string; behavior: string; category: string;
  injection_goal: string; suite: string; attack: string; source: string;
}
interface AgentDojoResult extends AgentDojoPrompt {
  bare_output: string; governed_output: string;
  blocked: boolean; duration_ms: number;
}

const RETRY_DELAYS = [30_000, 60_000, 120_000];
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(endpoint: string, prompt: string, sessionId: string) {
  const t = Date.now();
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRY_DELAYS.length) {
        process.stdout.write(` [rate-limit, retry in ${RETRY_DELAYS[attempt]/1000}s]`);
        await sleep(RETRY_DELAYS[attempt]); continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      return {
        governed_output: String(d.governed_output ?? ''),
        bare_output:     String(d.raw_output ?? ''),
        blocked:         Boolean(d.blocked),
        duration_ms:     Date.now() - t,
      };
    } catch { if (attempt === RETRY_DELAYS.length) throw e; await sleep(RETRY_DELAYS[attempt]); }
  }
  throw new Error('Max retries exceeded');
}

async function main() {
  const args     = minimist(process.argv.slice(2));
  const endpoint = (args.endpoint as string) ?? 'https://lexaureon.com';
  const outPath  = (args.out as string) ?? 'data/agentdojo-results.jsonl';

  const prompts: AgentDojoPrompt[] = fs.readFileSync(
    path.resolve('data/agentdojo.jsonl'), 'utf8'
  ).split('\n').filter(Boolean).map(l => JSON.parse(l));

  console.log(`[agentdojo] Debenedetti et al. NeurIPS 2024`);
  console.log(`[agentdojo] ${prompts.length} injection scenarios → ${endpoint}`);
  console.log(`[agentdojo] Suites: workspace · banking · travel · slack`);
  console.log(`[agentdojo] Attack: ImportantInstructions\n`);

  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let ok = 0, err = 0;
  const sessionId = `agtdj_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    process.stdout.write(`[${i+1}/${prompts.length}] [${p.suite}]`);
    if (i > 0) await sleep(3000);
    try {
      const result = await callGovern(endpoint, p.behavior, sessionId);
      out.write(JSON.stringify({ ...p, ...result } as AgentDojoResult) + '\n');
      ok++; process.stdout.write(` ✓ ok=${ok} err=${err}\n`);
    } catch (e) {
      err++; process.stdout.write(` ✗ ok=${ok} err=${err}\n`);
    }
  }
  out.end();
  console.log(`\n[agentdojo] done. Score with: npm run agentdojo:score -- --in ${outPath}`);
}
main().catch(console.error);
