/**
 * Unified Logging System for Lexaureon
 * 
 * Single coherent log stream across all services:
 * - API routes
 * - Observability
 * - Red-team testing
 * - Background jobs
 * 
 * Not fragmented. No scattered console.logs.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type LogSource = 'API' | 'METRICS' | 'TRAJECTORY' | 'RED_TEAM' | 'GOVERNOR' | 'AUDITOR' | 'BACKGROUND';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  context?: Record<string, any>;
  duration_ms?: number;
  user_id?: string;
  request_id?: string;
}

export interface LogAggregator {
  logs: LogEntry[];
  addLog(entry: LogEntry): void;
  getLogs(filter?: Partial<LogEntry>): LogEntry[];
  export(): string;
  clear(): void;
}

class UnifiedLoggerImpl implements LogAggregator {
  logs: LogEntry[] = [];
  private maxLogs = 10000;
  private requestId: string;

  constructor(requestId?: string) {
    this.requestId = requestId || this.generateRequestId();
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  addLog(entry: LogEntry): void {
    const fullEntry: LogEntry = {
      ...entry,
      request_id: entry.request_id || this.requestId,
    };

    this.logs.push(fullEntry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (entry.level === 'ERROR' || entry.level === 'CRITICAL') {
      const prefix = `[${entry.level}] [${entry.source}]`;
      console.error(prefix, entry.message, entry.context || '');
    }
  }

  debug(source: LogSource, message: string, context?: Record<string, any>) {
    this.addLog({ timestamp: new Date().toISOString(), level: 'DEBUG', source, message, context });
  }

  info(source: LogSource, message: string, context?: Record<string, any>) {
    this.addLog({ timestamp: new Date().toISOString(), level: 'INFO', source, message, context });
  }

  warn(source: LogSource, message: string, context?: Record<string, any>) {
    this.addLog({ timestamp: new Date().toISOString(), level: 'WARN', source, message, context });
  }

  error(source: LogSource, message: string, context?: Record<string, any>) {
    this.addLog({ timestamp: new Date().toISOString(), level: 'ERROR', source, message, context });
  }

  critical(source: LogSource, message: string, context?: Record<string, any>) {
    this.addLog({ timestamp: new Date().toISOString(), level: 'CRITICAL', source, message, context });
  }

  startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }

  getLogs(filter?: Partial<LogEntry>): LogEntry[] {
    if (!filter) return [...this.logs];
    return this.logs.filter(log =>
      Object.entries(filter).every(([key, value]) => (log as any)[key] === value)
    );
  }

  export(): string {
    return JSON.stringify({ request_id: this.requestId, log_count: this.logs.length, logs: this.logs }, null, 2);
  }

  exportFormatted(): string {
    return this.logs.map(log => {
      const parts = [log.timestamp, `[${log.level}]`, `[${log.source}]`, log.message];
      if (log.context) parts.push(JSON.stringify(log.context));
      if (log.duration_ms) parts.push(`(${log.duration_ms}ms)`);
      return parts.join(' ');
    }).join('\n');
  }

  clear(): void {
    this.logs = [];
  }
}

let globalLogger: UnifiedLoggerImpl | null = null;

export function getLogger(requestId?: string): UnifiedLoggerImpl {
  if (!globalLogger) {
    globalLogger = new UnifiedLoggerImpl(requestId);
  }
  return globalLogger;
}

export function createRequestLogger(requestId: string): UnifiedLoggerImpl {
  return new UnifiedLoggerImpl(requestId);
}

export function resetGlobalLogger(): void {
  globalLogger = null;
}
