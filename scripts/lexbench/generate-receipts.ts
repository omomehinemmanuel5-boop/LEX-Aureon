import fs from 'fs';
import path from 'path';
import manifest from '../../data/lexbench-v2.json';
import { createReceipt } from '../../lib/lexbench/receipt';
import { sha256 } from '../../lib/lexbench/hash';

const outDir = path.resolve('results/receipts');
fs.mkdirSync(outDir, { recursive: true });

for (const b of manifest.benchmarks) {
  const datasetHash = sha256(b.name + String(b.sample_count ?? ''));
  const resultHash = sha256(JSON.stringify(b));
  const receipt = createReceipt({
    benchmark: b.name,
    run: '001',
    commit: process.env.GIT_SHA || 'local',
    datasetHash,
    resultHash,
  });
  const file = path.join(outDir, `${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
}

console.log(`Generated ${manifest.benchmarks.length} receipts.`);
