import { env } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  t: string;
  level: Level;
  scope: string;
  msg: string;
  [k: string]: unknown;
}

function drain(entry: LogEntry): void {
  const url = env.LOG_DRAIN_URL;
  if (!url) return;
  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.LOG_DRAIN_TOKEN ? { Authorization: 'Bearer ' + env.LOG_DRAIN_TOKEN } : {}),
    },
    body: JSON.stringify(entry),
    signal: AbortSignal.timeout(2000),
  }).catch(() => { /* never propagate */ });
}

function grafanaLokiDrain(entry: LogEntry): void {
  const url = env.GRAFANA_LOKI_URL;
  const user = env.GRAFANA_LOKI_USER;
  const token = env.GRAFANA_LOKI_TOKEN;
  if (!url || !user || !token) return;

  const timestamp = String(Math.max(0, Date.parse(entry.t)) * 1_000_000);
  const payload = {
    streams: [{
      stream: {
        service: 'lex-aureon',
        environment: process.env.NODE_ENV ?? 'production',
        level: entry.level,
        scope: entry.scope,
      },
      values: [[timestamp, JSON.stringify(entry)]],
    }],
  };
  const authorization = Buffer.from(user + ':' + token).toString('base64');
  void fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  }).catch(() => { /* telemetry must never break the application */ });
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
  grafanaLokiDrain(entry);
}

export const logger = {
  debug: (scope: string, msg: string, fields?: Record<string, unknown>) => emit('debug', scope, msg, fields),
  info: (scope: string, msg: string, fields?: Record<string, unknown>) => emit('info', scope, msg, fields),
  warn: (scope: string, msg: string, fields?: Record<string, unknown>) => emit('warn', scope, msg, fields),
  error: (scope: string, msg: string, fields?: Record<string, unknown>) => emit('error', scope, msg, fields),
};

export function errorFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    const newline = String.fromCharCode(10);
    return { error: e.message, stack: e.stack?.split(newline).slice(0, 5).join(newline) };
  }
  return { error: String(e) };
}
