/**
 * Artifact Signing System.
 *
 * Evaluation artifacts are signed with Ed25519. Hashes provide content
 * addressing; signatures provide authenticity and tamper evidence.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'crypto';

export interface SignedArtifact {
  run_id: string;
  metrics: {
    asr?: number;
    toxicity?: number;
    truth_score?: number;
    [key: string]: unknown;
  };
  artifact_hash: string;
  signature: string;
  public_key: string;
  environment: {
    node_version: string;
    platform: string;
    arch: string;
    timestamp: string;
  };
  verification_status: 'pending' | 'verified' | 'failed';
}

export interface ArtifactBundle {
  bundle_id: string;
  created_at: string;
  artifacts: SignedArtifact[];
  bundle_hash: string;
  bundle_signature: string;
  bundle_public_key: string;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export class KeyManager {
  private keyDir: string;
  private privateKeyPath: string;
  private publicKeyPath: string;

  constructor(keyDir: string = '.lexbench-keys') {
    this.keyDir = keyDir;
    this.privateKeyPath = path.join(keyDir, 'id_ed25519');
    this.publicKeyPath = path.join(keyDir, 'id_ed25519.pub');
    this.ensureKeys();
  }

  private ensureKeys(): void {
    if (!fs.existsSync(this.keyDir)) fs.mkdirSync(this.keyDir, { recursive: true });

    if (fs.existsSync(this.privateKeyPath) && fs.existsSync(this.publicKeyPath)) return;

    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    fs.writeFileSync(this.privateKeyPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(this.publicKeyPath, publicKey, { mode: 0o644 });
  }

  public getPublicKey(): string {
    return fs.readFileSync(this.publicKeyPath, 'utf8').trim();
  }

  public getPrivateKey(): ReturnType<typeof createPrivateKey> {
    return createPrivateKey(fs.readFileSync(this.privateKeyPath, 'utf8'));
  }
}

export class ArtifactSigner {
  private keyManager: KeyManager;

  constructor(keyDir?: string) {
    this.keyManager = new KeyManager(keyDir);
  }

  public signArtifact(runId: string, metrics: Record<string, unknown>): SignedArtifact {
    const artifactHash = hashCanonical({ run_id: runId, metrics });
    const signature = sign(null, Buffer.from(artifactHash, 'utf8'), this.keyManager.getPrivateKey())
      .toString('base64');

    return {
      run_id: runId,
      metrics,
      artifact_hash: artifactHash,
      signature,
      public_key: this.keyManager.getPublicKey(),
      environment: {
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        timestamp: new Date().toISOString(),
      },
      verification_status: 'pending',
    };
  }

  public verifyArtifact(artifact: SignedArtifact): boolean {
    const expectedHash = hashCanonical({ run_id: artifact.run_id, metrics: artifact.metrics });
    if (expectedHash !== artifact.artifact_hash) return false;

    try {
      return verify(
        null,
        Buffer.from(artifact.artifact_hash, 'utf8'),
        createPublicKey(artifact.public_key),
        Buffer.from(artifact.signature, 'base64'),
      );
    } catch {
      return false;
    }
  }

  public createBundle(artifacts: SignedArtifact[]): ArtifactBundle {
    const bundleId = `bundle-${Date.now()}`;
    const bundleHash = hashCanonical(artifacts);
    const bundleSignature = sign(
      null,
      Buffer.from(bundleHash, 'utf8'),
      this.keyManager.getPrivateKey(),
    ).toString('base64');

    return {
      bundle_id: bundleId,
      created_at: new Date().toISOString(),
      artifacts,
      bundle_hash: bundleHash,
      bundle_signature: bundleSignature,
      bundle_public_key: this.keyManager.getPublicKey(),
    };
  }

  public verifyBundle(bundle: ArtifactBundle): boolean {
    if (bundle.artifacts.some(artifact => !this.verifyArtifact(artifact))) return false;
    const computedHash = hashCanonical(bundle.artifacts);
    if (computedHash !== bundle.bundle_hash) return false;

    try {
      return verify(
        null,
        Buffer.from(bundle.bundle_hash, 'utf8'),
        createPublicKey(bundle.bundle_public_key),
        Buffer.from(bundle.bundle_signature, 'base64'),
      );
    } catch {
      return false;
    }
  }
}

export default { KeyManager, ArtifactSigner };
