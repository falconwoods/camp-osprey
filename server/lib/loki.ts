export type LokiLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LokiLogEntry {
  level: LokiLogLevel;
  event: string;
  message: string;
  ts?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type LokiLogFields = Omit<Partial<LokiLogEntry>, 'level' | 'event' | 'message'> & Record<string, unknown>;

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function stringifyLogPayload(value: unknown): string {
  return JSON.stringify(value, jsonReplacer);
}

export function logServerEvent(entry: LokiLogEntry): void {
  const { level, ...payload } = entry;
  const consoleMethod = level === 'warning' ? 'warn' : level;
  const ts = entry.ts ?? new Date().toISOString();
  console[consoleMethod](stringifyLogPayload({ ...payload, level, ts }));
}

function log(level: LokiLogLevel, event: string, message: string, fields: LokiLogFields = {}): void {
  logServerEvent({
    ...fields,
    level,
    event,
    message,
  });
}

export const logger = {
  debug(event: string, message: string, fields?: LokiLogFields): void {
    log('debug', event, message, fields);
  },
  info(event: string, message: string, fields?: LokiLogFields): void {
    log('info', event, message, fields);
  },
  warn(event: string, message: string, fields?: LokiLogFields): void {
    log('warning', event, message, fields);
  },
  error(event: string, message: string, fields?: LokiLogFields): void {
    log('error', event, message, fields);
  },
};
