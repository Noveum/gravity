import { describe, expect, test } from 'bun:test';
import { slugify } from '../../src/utils/index.ts';

describe('slugify', () => {
  test('lowercases and dashes separators', () => {
    expect(slugify('Realtime Sync Engine')).toBe('realtime-sync-engine');
  });

  test('strips punctuation and collapses repeats', () => {
    expect(slugify('  Docs && Attachments!!  ')).toBe('docs-attachments');
  });

  test('folds accents', () => {
    expect(slugify('Zoë Müller')).toBe('zoe-muller');
  });

  test('returns an empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });

  test('caps the length at 64 characters', () => {
    expect(slugify('a'.repeat(100))).toHaveLength(64);
  });
});
