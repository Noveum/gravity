import { safeErrorFields } from '@gravity/shared/utils';

type LogFields = Record<string, unknown>;

type LogLevel = 'info' | 'warn' | 'error';

export const QUIET_LOGS_ENV = 'GRAVITY_QUIET_LOGS';

function write(level: LogLevel, message: string, fields: LogFields | undefined): void {
  if (process.env[QUIET_LOGS_ENV] === 'true') return;
  const line = JSON.stringify({
    level,
    message,
    at: new Date().toISOString(),
    service: 'mcp',
    ...fields,
  });
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.info(line);
}

export const logger = {
  info: (message: string, fields?: LogFields): void => write('info', message, fields),
  warn: (message: string, fields?: LogFields): void => write('warn', message, fields),
  error: (message: string, fields?: LogFields): void => write('error', message, fields),
};

export const errorFields = safeErrorFields;
