type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, fields?: Record<string, unknown>): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const entry = {
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
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
