type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  t: string;
  level: Level;
  scope: string;
  msg: string;
  [k: string]: unknown;
}

/**
 * Optional remote log drain. When LOG_DRAIN_URL is set, warn/error entries
 * are also POSTed there (Axiom / Logflare / Datadog HTTP intake / custom).
 * Best-effort fire-and-forget — never blocks the caller, never throws.
 */
function drain(entry: LogEntry): void {
  const url = process.env.LOG_DRAIN_URL;
  if (!url) return;
  // Don't await: serverless will hold the function open via Response anyway.
  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.LOG_DRAIN_TOKEN ? { Authorization: `Bearer ${process.env.LOG_DRAIN_TOKEN}` } : {}),
    },
    body: JSON.stringify(entry),
    // Short timeout so a hung drain never starves the function.
    signal: AbortSignal.timeout(2000),
  }).catch(() => { /* never propagate */ });
}

function emit(level: Level, scope: string, message: string, fields?: Record<string, unknown>): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const entry: LogEntry = {
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
    drain(entry);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (scope: string, msg: string, fields?: Record<string, unknown>) => emit('debug', scope, msg, fields),
  info:  (scope: string, msg: string, fields?: Record<string, unknown>) => emit('info',  scope, msg, fields),
  warn:  (scope: string, msg: string, fields?: Record<string, unknown>) => emit('warn',  scope, msg, fields),
  error: (scope: string, msg: string, fields?: Record<string, unknown>) => emit('error', scope, msg, fields),
};

export function errorFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { error: e.message, stack: e.stack?.split('\n').slice(0, 5).join('\n') };
  }
  return { error: String(e) };
}
