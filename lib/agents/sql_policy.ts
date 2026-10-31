/**
 * Shared SQL operation classification.
 *
 * This is deliberately conservative: only a single read-only SELECT/CTE is
 * classified as read. Empty, malformed, multi-statement, and mutating SQL is
 * never treated as read-only.
 */
export type DatabaseOperation = 'read' | 'write' | 'invalid';

export function classifyDatabaseOperation(sql: string): DatabaseOperation {
  let normalized = sql
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)+/g, '')
    .trim();

  // A single terminal semicolon is normal SQL syntax; internal or multiple
  // statements remain invalid and therefore fail closed.
  if (normalized.endsWith(';')) normalized = normalized.slice(0, -1).trim();
  if (!normalized || normalized.includes(';')) return 'invalid';

  if (/^with\b/i.test(normalized)
    && /\b(insert|update|delete|replace|drop|alter|create|pragma|attach|detach|vacuum)\b/i.test(normalized)) {
    return 'write';
  }
  if (/^(?:select|with)\b/i.test(normalized)) return 'read';
  return 'write';
}
