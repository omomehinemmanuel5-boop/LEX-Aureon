import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactSigner } from '../lib/artifact_signer';

const temporaryDirectories: string[] = [];

function makeSigner(): ArtifactSigner {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-artifact-'));
  temporaryDirectories.push(directory);
  return new ArtifactSigner(directory);
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

describe('ArtifactSigner', () => {
  it('creates verifiable Ed25519-signed artifacts', () => {
    const signer = makeSigner();
    const artifact = signer.signArtifact('run-1', { attack_success_rate: 0.02 });

    expect(artifact.signature).not.toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.key_version).toMatch(/^ed25519-[a-f0-9]{16}$/);
    expect(signer.verifyArtifact(artifact)).toBe(true);
  });

  it('rejects modified artifact metrics', () => {
    const signer = makeSigner();
    const artifact = signer.signArtifact('run-2', { truth_score: 0.91 });
    artifact.metrics.truth_score = 0.01;

    expect(signer.verifyArtifact(artifact)).toBe(false);
  });

  it('verifies bundles and rejects modified members', () => {
    const signer = makeSigner();
    const first = signer.signArtifact('run-3', { utility: 0.8 });
    const second = signer.signArtifact('run-4', { utility: 0.9 });
    const bundle = signer.createBundle([first, second]);

    expect(signer.verifyBundle(bundle)).toBe(true);
    expect(bundle.key_version).toMatch(/^ed25519-[a-f0-9]{16}$/);
    bundle.artifacts[1].run_id = 'tampered-run';
    expect(signer.verifyBundle(bundle)).toBe(false);
  });

  it('rejects a signature replayed with a different key version', () => {
    const signer = makeSigner();
    const artifact = signer.signArtifact('run-5', { utility: 1 });
    artifact.key_version = 'ed25519-replayed-key';

    expect(signer.verifyArtifact(artifact)).toBe(false);
  });
});
