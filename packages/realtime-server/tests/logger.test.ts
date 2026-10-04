import { afterEach, expect, spyOn, test } from 'bun:test';
import { consoleLogSink, type LogSink, logger, setLogSink } from '../src/logger.ts';

let restore: LogSink | null = null;

afterEach(() => {
  if (restore !== null) setLogSink(restore);
  restore = null;
});

test('the tests preload installs a silent sink, so nothing reaches the console', () => {
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

test('a sink receives every level as one JSON line', () => {
  const lines: { level: string; line: string }[] = [];
  restore = setLogSink((level, line) => lines.push({ level, line }));
  logger.warn('seen', { tool: 'search' });
  logger.error('broken');
  expect(lines.map((entry) => entry.level)).toEqual(['warn', 'error']);
  expect(JSON.parse(lines[0]?.line ?? '{}')).toMatchObject({
    level: 'warn',
    message: 'seen',
    service: 'realtime',
    tool: 'search',
  });
});

test('the console sink writes errors to stderr and the rest to stdout', () => {
  const info = spyOn(console, 'info').mockImplementation(() => undefined);
  const error = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    restore = setLogSink(consoleLogSink);
    logger.info('out');
    logger.error('err');
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});
