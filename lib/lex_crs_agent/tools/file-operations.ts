/**
 * ═══════════════════════════════════════════════════════════════════════
 * FILE OPERATIONS TOOLS — Constitutional File I/O
 * 
 * Tools for reading, writing, and managing files within constitutional bounds.
 * All operations are measured by CRS and gated by tool-proxy.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'fs/promises';
import path from 'path';

// Allowed base directories (whitelist)
const ALLOWED_ROOTS = [
  process.cwd(),
  '/home/ubuntu/LEX-Aureon',
  '/tmp',
];

// Blocked patterns
const BLOCKED_PATTERNS = [
  /\/\.env/i,
  /\/\.git\//i,
  /\/node_modules\//i,
  /\/\.next\//i,
  /\/dist\//i,
  /\/build\//i,
];

function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  
  // Check whitelist
  const isInAllowed = ALLOWED_ROOTS.some(root => resolved.startsWith(path.resolve(root)));
  if (!isInAllowed) return false;
  
  // Check blocked patterns
  if (BLOCKED_PATTERNS.some(p => p.test(resolved))) return false;
  
  return true;
}

/**
 * Read a file from the repository or filesystem.
 * Returns file content with metadata.
 */
export async function readFile(filePath: string): Promise<{
  success: boolean;
  content?: string;
  size?: number;
  encoding?: string;
  error?: string;
}> {
  try {
    if (!isPathAllowed(filePath)) {
      return { success: false, error: `Access denied: ${filePath}` };
    }

    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      return { success: false, error: `Is a directory: ${filePath}` };
    }

    if (stat.size > 10 * 1024 * 1024) {
      return { success: false, error: `File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB` };
    }

    const content = await fs.readFile(resolved, 'utf-8');

    return {
      success: true,
      content,
      size: stat.size,
      encoding: 'utf-8',
    };
  } catch (e) {
    return { success: false, error: `Read error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

/**
 * Write content to a file.
 * Creates parent directories if needed.
 * Returns success status and file metadata.
 */
export async function writeFile(filePath: string, content: string): Promise<{
  success: boolean;
  size?: number;
  path?: string;
  error?: string;
}> {
  try {
    if (!isPathAllowed(filePath)) {
      return { success: false, error: `Access denied: ${filePath}` };
    }

    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);

    // Create parent directories
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(resolved, content, 'utf-8');

    // Return metadata
    const stat = await fs.stat(resolved);

    return {
      success: true,
      size: stat.size,
      path: resolved,
    };
  } catch (e) {
    return { success: false, error: `Write error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

/**
 * List files in a directory.
 * Returns directory tree with file metadata.
 */
export async function listFiles(dirPath: string, maxDepth: number = 2): Promise<{
  success: boolean;
  files?: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
  }>;
  error?: string;
}> {
  try {
    if (!isPathAllowed(dirPath)) {
      return { success: false, error: `Access denied: ${dirPath}` };
    }

    const resolved = path.resolve(dirPath);
    const stat = await fs.stat(resolved);

    if (!stat.isDirectory()) {
      return { success: false, error: `Not a directory: ${dirPath}` };
    }

    const files: Array<{
      name: string;
      path: string;
      type: 'file' | 'directory';
      size?: number;
    }> = [];

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files and blocked patterns
          if (entry.name.startsWith('.') || BLOCKED_PATTERNS.some(p => p.test(entry.name))) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(resolved, fullPath);

          if (entry.isDirectory()) {
            files.push({
              name: entry.name,
              path: relPath,
              type: 'directory',
            });
            await walk(fullPath, depth + 1);
          } else {
            const stat = await fs.stat(fullPath);
            files.push({
              name: entry.name,
              path: relPath,
              type: 'file',
              size: stat.size,
            });
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    await walk(resolved, 0);

    return { success: true, files };
  } catch (e) {
    return { success: false, error: `List error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

/**
 * Delete a file.
 * Returns success status.
 */
export async function deleteFile(filePath: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (!isPathAllowed(filePath)) {
      return { success: false, error: `Access denied: ${filePath}` };
    }

    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      return { success: false, error: `Is a directory: ${filePath}` };
    }

    await fs.unlink(resolved);

    return { success: true };
  } catch (e) {
    return { success: false, error: `Delete error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

/**
 * Get file metadata.
 * Returns size, modification time, permissions, etc.
 */
export async function getFileMetadata(filePath: string): Promise<{
  success: boolean;
  size?: number;
  modified?: number;
  created?: number;
  isDirectory?: boolean;
  error?: string;
}> {
  try {
    if (!isPathAllowed(filePath)) {
      return { success: false, error: `Access denied: ${filePath}` };
    }

    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);

    return {
      success: true,
      size: stat.size,
      modified: stat.mtime.getTime(),
      created: stat.birthtime.getTime(),
      isDirectory: stat.isDirectory(),
    };
  } catch (e) {
    return { success: false, error: `Metadata error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}
