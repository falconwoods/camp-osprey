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

function isServerLocalDebugEnabled(): boolean {
  return process.env.SERVER_LOCAL_DEBUG === 'true';
}

function formatLocalDebugConsoleLogArgs(entry: LokiLogEntry & { ts: string }): unknown[] {
  const { level, event, message, ts, ...fields } = entry;
  const header = `[${ts}] ${level.toUpperCase()} ${event}: ${message}`;
  const args: unknown[] = [header];
  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      args.push(value);
    } else {
      data[key] = value;
    }
  }

  if (Object.keys(data).length > 0) {
    args.splice(1, 0, data);
  }

  return args;
}

export function logServerEvent(entry: LokiLogEntry): void {
  const { level, ...payload } = entry;
  const consoleMethod = level === 'warning' ? 'warn' : level;
  const ts = entry.ts ?? new Date().toISOString();
  const logPayload = { ...payload, level, ts };

  if (isServerLocalDebugEnabled()) {
    console[consoleMethod](...formatLocalDebugConsoleLogArgs(logPayload));
    return;
  }

  console[consoleMethod](stringifyLogPayload(logPayload));
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
