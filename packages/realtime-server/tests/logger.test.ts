import { afterEach, expect, spyOn, test } from 'bun:test';
import { logger, QUIET_LOGS_ENV } from '../src/logger.ts';

const quiet = process.env[QUIET_LOGS_ENV];

afterEach(() => {
  if (quiet === undefined) delete process.env[QUIET_LOGS_ENV];
  else process.env[QUIET_LOGS_ENV] = quiet;
});

test('the tests preload keeps the logger quiet', () => {
  expect(process.env[QUIET_LOGS_ENV]).toBe('true');
  const info = spyOn(console, 'info').mockImplementation(() => undefined);
  const error = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    logger.info('hidden');
    logger.error('hidden');
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});

test('without the quiet switch every level is written as one JSON line', () => {
  delete process.env[QUIET_LOGS_ENV];
  const info = spyOn(console, 'info').mockImplementation(() => undefined);
  const error = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    logger.warn('seen', { tool: 'search' });
    logger.error('broken');
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      level: 'warn',
      message: 'seen',
      service: 'realtime',
      tool: 'search',
    });
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ level: 'error' });
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});
