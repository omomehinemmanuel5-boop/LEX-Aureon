import fs from 'fs';
import path from 'path';

/**
 * Generates a dynamic summary of the codebase.
 */
export function getCodebaseSummary(): string {
  const rootDir = process.cwd();
  const libDir = path.join(rootDir, 'lib');
  
  let totalFiles = 0;
  const keyDirs: Record<string, number> = {};

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (dir === rootDir || dir === libDir) {
          keyDirs[file] = (keyDirs[file] || 0);
        }
        walk(fullPath);
      } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        totalFiles++;
        const relativeDir = path.relative(rootDir, dir).split(path.sep)[0] || 'root';
        keyDirs[relativeDir] = (keyDirs[relativeDir] || 0) + 1;
      }
    }
  }

  walk(rootDir);

  const dirSummary = Object.entries(keyDirs)
    .filter(([_, count]) => count > 0)
    .map(([dir, count]) => `${dir} (${count} files)`)
    .join(', ');

  return `Codebase Summary: ${totalFiles} TypeScript files across ${Object.keys(keyDirs).length} main directories. Key modules: ${dirSummary}.`;
}
