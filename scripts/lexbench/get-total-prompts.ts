import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const BENCHMARK_CONFIGS: Record<string, { dataFile: string }> = {
  truthfulqa: { dataFile: 'data/truthfulqa.jsonl' },
  harmbench: { dataFile: 'data/harmbench.jsonl' },
  jailbreakbench: { dataFile: 'data/jailbreakbench.jsonl' },
  advbench: { dataFile: 'data/advbench.jsonl' },
  agentdojo: { dataFile: 'data/agentdojo.jsonl' },
};

async function countLines(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineCount = 0;
  for await (const line of rl) {
    if (line.trim() !== '') {
      lineCount++;
    }
  }
  return lineCount;
}

async function main() {
  let totalPrompts = 0;
  for (const key in BENCHMARK_CONFIGS) {
    const config = BENCHMARK_CONFIGS[key];
    const filePath = path.join(process.cwd(), config.dataFile);
    totalPrompts += await countLines(filePath);
  }
  console.log(totalPrompts);
}

main();
