import { safeErrorFields } from '@gravity/shared/utils';

type LogFields = Record<string, unknown>;

export type LogLevel = 'info' | 'warn' | 'error';

export type LogSink = (level: LogLevel, line: string) => void;

export const consoleLogSink: LogSink = (level, line) => {
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.info(line);
};

let sink: LogSink = consoleLogSink;

export function setLogSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}

function write(level: LogLevel, message: string, fields: LogFields | undefined): void {
  sink(
    level,
    JSON.stringify({ level, message, at: new Date().toISOString(), service: 'mcp', ...fields }),
  );
}

export const logger = {
  info: (message: string, fields?: LogFields): void => write('info', message, fields),
  warn: (message: string, fields?: LogFields): void => write('warn', message, fields),
  error: (message: string, fields?: LogFields): void => write('error', message, fields),
};

export const errorFields = safeErrorFields;
