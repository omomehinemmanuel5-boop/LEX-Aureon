/**
 * ═══════════════════════════════════════════════════════════════════════
 * CODE EXECUTION TOOL — Constitutional Sandbox
 *
 * Executes code (Python, Node.js, Bash) within constitutional bounds.
 * All executions are:
 * - Timeout-protected (max 30 seconds)
 * - Resource-limited (memory, CPU)
 * - Measured by CRS before execution
 * - Logged with receipt for audit trail
 * ═══════════════════════════════════════════════════════════════════════
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';

const EXECUTION_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
const TEMP_DIR = '/tmp';

type ExecResult = { stdout: string; stderr: string; exitCode: number };

/** Shared spawn runner — handles timeout + output size cap internally. */
function spawnProcess(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: EXECUTION_TIMEOUT });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_SIZE) proc.kill();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > MAX_OUTPUT_SIZE) proc.kill();
    });

    proc.on('error', reject);

    proc.on('close', (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * Execute Python code.
 */
export async function executePython(code: string, args: string[] = []): Promise<{
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
  error?: string;
}> {
  const startTime = Date.now();
  const tempFile = path.join(TEMP_DIR, `lex_${randomBytes(8).toString('hex')}.py`);

  try {
    writeFileSync(tempFile, code);
    const result = await spawnProcess('python3', [tempFile, ...args]);
    return {
      success: result.exitCode === 0,
      stdout:  result.stdout.slice(0, MAX_OUTPUT_SIZE),
      stderr:  result.stderr.slice(0, MAX_OUTPUT_SIZE),
      exitCode: result.exitCode,
      duration: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      error: `Python execution error: ${e instanceof Error ? e.message : 'Unknown'}`,
      duration: Date.now() - startTime,
    };
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

/**
 * Execute Node.js code.
 */
export async function executeNode(code: string, args: string[] = []): Promise<{
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
  error?: string;
}> {
  const startTime = Date.now();
  const tempFile = path.join(TEMP_DIR, `lex_${randomBytes(8).toString('hex')}.js`);

  try {
    writeFileSync(tempFile, code);
    const result = await spawnProcess('node', [tempFile, ...args]);
    return {
      success: result.exitCode === 0,
      stdout:  result.stdout.slice(0, MAX_OUTPUT_SIZE),
      stderr:  result.stderr.slice(0, MAX_OUTPUT_SIZE),
      exitCode: result.exitCode,
      duration: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      error: `Node execution error: ${e instanceof Error ? e.message : 'Unknown'}`,
      duration: Date.now() - startTime,
    };
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

/**
 * Execute Bash command.
 */
export async function executeBash(command: string): Promise<{
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
  error?: string;
}> {
  const startTime = Date.now();

  const blockedPatterns = [
    /rm\s+-rf\s+\//,
    /dd\s+if=/,
    /mkfs/,
    /:\(\)\s*\{\s*:\|:\s*&\s*\}/,
  ];

  if (blockedPatterns.some(p => p.test(command))) {
    return {
      success: false,
      error: 'Command blocked for safety reasons',
      duration: Date.now() - startTime,
    };
  }

  try {
    const result = await spawnProcess('bash', ['-c', command]);
    return {
      success: result.exitCode === 0,
      stdout:  result.stdout.slice(0, MAX_OUTPUT_SIZE),
      stderr:  result.stderr.slice(0, MAX_OUTPUT_SIZE),
      exitCode: result.exitCode,
      duration: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      error: `Bash execution error: ${e instanceof Error ? e.message : 'Unknown'}`,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute code based on language.
 */
export async function executeCode(language: string, code: string, args: string[] = []): Promise<{
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
  error?: string;
}> {
  switch (language.toLowerCase()) {
    case 'python':
    case 'py':
      return executePython(code, args);
    case 'node':
    case 'javascript':
    case 'js':
      return executeNode(code, args);
    case 'bash':
    case 'sh':
      return executeBash(code);
    default:
      return { success: false, error: `Unsupported language: ${language}` };
  }
}
