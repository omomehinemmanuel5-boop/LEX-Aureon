/**
 * Reproducibility Engine — PHASE 2
 * 
 * Implements:
 * 1. Run Manifest (git commit hash, model version, endpoint version, dataset hashes)
 * 2. Deterministic execution rules (fixed ordering, shard-based execution, cache-first)
 * 3. Result hashing (SHA-256 full run hash, per-benchmark hash, per-shard hash)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────

export interface RunManifest {
  run_id: string;
  timestamp: string;
  git_commit_hash: string;
  git_branch: string;
  git_dirty: boolean;
  model_version: string;
  endpoint_version: string;
  dataset_hashes: Record<string, string>;
  environment: {
    node_version: string;
    platform: string;
    arch: string;
    cwd: string;
  };
  execution_config: {
    fixed_ordering: boolean;
    shard_based: boolean;
    cache_first: boolean;
    rate_limit_req_min: number;
    token_cap_per_request: number;
  };
}

export interface RunResultHashes {
  full_run_hash: string;
  per_benchmark_hashes: Record<string, string>;
  per_shard_hashes: Record<string, string>;
  manifest_hash: string;
}

export interface ReproducibilityBundle {
  manifest: RunManifest;
  hashes: RunResultHashes;
  metadata: {
    total_prompts: number;
    total_duration_ms: number;
    benchmarks_run: string[];
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Git Information Extraction
// ────────────────────────────────────────────────────────────────────────────

function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function isGitDirty(): boolean {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    return status.length > 0;
  } catch {
    return true;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Dataset Hashing
// ────────────────────────────────────────────────────────────────────────────

function hashFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch (err) {
    console.warn(`[WARN] Could not hash file ${filePath}: ${err}`);
    return 'error';
  }
}

function getDatasetHashes(): Record<string, string> {
  const dataDir = 'data';
  const hashes: Record<string, string> = {};

  const datasets = [
    'truthfulqa.jsonl',
    'harmbench.jsonl',
    'jailbreakbench.jsonl',
    'advbench.jsonl',
    'agentdojo.jsonl',
  ];

  for (const dataset of datasets) {
    const filePath = path.join(dataDir, dataset);
    if (fs.existsSync(filePath)) {
      hashes[dataset] = hashFile(filePath);
    }
  }

  return hashes;
}

// ────────────────────────────────────────────────────────────────────────────
// Create Run Manifest
// ────────────────────────────────────────────────────────────────────────────

export function createRunManifest(
  modelVersion: string = 'unknown',
  endpointVersion: string = 'unknown',
): RunManifest {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    git_commit_hash: getGitCommitHash(),
    git_branch: getGitBranch(),
    git_dirty: isGitDirty(),
    model_version: modelVersion,
    endpoint_version: endpointVersion,
    dataset_hashes: getDatasetHashes(),
    environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    },
    execution_config: {
      fixed_ordering: true,
      shard_based: true,
      cache_first: true,
      rate_limit_req_min: 10,
      token_cap_per_request: 2048,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Hash Results
// ────────────────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function computeResultHashes(
  resultsDir: string,
  manifest: RunManifest,
): RunResultHashes {
  const perBenchmarkHashes: Record<string, string> = {};
  const perShardHashes: Record<string, string> = {};
  let fullRunContent = '';

  // Collect all result files
  if (!fs.existsSync(resultsDir)) {
    console.warn(`[WARN] Results directory not found: ${resultsDir}`);
    return {
      full_run_hash: 'error',
      per_benchmark_hashes: {},
      per_shard_hashes: {},
      manifest_hash: hashContent(JSON.stringify(manifest)),
    };
  }

  const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith('.jsonl'));

  for (const file of files) {
    const filePath = path.join(resultsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = hashContent(content);

    // Extract benchmark name from filename (e.g., lexbench-truthfulqa-*.jsonl)
    const benchmarkMatch = file.match(/lexbench-([a-z]+)/);
    if (benchmarkMatch) {
      const benchmarkName = benchmarkMatch[1];
      perBenchmarkHashes[benchmarkName] = hash;
    }

    // Treat each file as a shard
    perShardHashes[file] = hash;

    // Accumulate for full run hash
    fullRunContent += content;
  }

  const fullRunHash = hashContent(fullRunContent);
  const manifestHash = hashContent(JSON.stringify(manifest));

  return {
    full_run_hash: fullRunHash,
    per_benchmark_hashes: perBenchmarkHashes,
    per_shard_hashes: perShardHashes,
    manifest_hash: manifestHash,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Create Reproducibility Bundle
// ────────────────────────────────────────────────────────────────────────────

export function createReproducibilityBundle(
  manifest: RunManifest,
  resultsDir: string,
  metadata: {
    total_prompts: number;
    total_duration_ms: number;
    benchmarks_run: string[];
  },
): ReproducibilityBundle {
  const hashes = computeResultHashes(resultsDir, manifest);

  return {
    manifest,
    hashes,
    metadata,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Save Reproducibility Bundle
// ────────────────────────────────────────────────────────────────────────────

export function saveReproducibilityBundle(
  bundle: ReproducibilityBundle,
  outputDir: string = 'data',
): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = path.join(
    outputDir,
    `reproducibility-bundle-${timestamp}.json`,
  );

  fs.writeFileSync(outputFile, JSON.stringify(bundle, null, 2));
  console.log(`[SAVED] Reproducibility bundle written to ${outputFile}`);

  return outputFile;
}

// ────────────────────────────────────────────────────────────────────────────
// Verify Reproducibility Bundle
// ────────────────────────────────────────────────────────────────────────────

export function verifyReproducibilityBundle(
  bundleFile: string,
  resultsDir: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const bundleContent = fs.readFileSync(bundleFile, 'utf-8');
    const bundle: ReproducibilityBundle = JSON.parse(bundleContent);

    // Verify manifest exists
    if (!bundle.manifest) {
      errors.push('Manifest not found in bundle');
    }

    // Verify hashes exist
    if (!bundle.hashes) {
      errors.push('Hashes not found in bundle');
    }

    // Verify metadata exists
    if (!bundle.metadata) {
      errors.push('Metadata not found in bundle');
    }

    // Recompute hashes and compare
    const recomputedHashes = computeResultHashes(resultsDir, bundle.manifest);
    if (recomputedHashes.full_run_hash !== bundle.hashes.full_run_hash) {
      errors.push(
        `Full run hash mismatch: expected ${bundle.hashes.full_run_hash}, got ${recomputedHashes.full_run_hash}`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (err) {
    return {
      valid: false,
      errors: [String(err)],
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Export for use in other modules
// ────────────────────────────────────────────────────────────────────────────

export default {
  createRunManifest,
  computeResultHashes,
  createReproducibilityBundle,
  saveReproducibilityBundle,
  verifyReproducibilityBundle,
};
