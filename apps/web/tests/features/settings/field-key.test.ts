import { describe, expect, test } from 'bun:test';
import { fieldKeySchema, fieldOptionSchema } from '@gravity/shared/validators';
import { fieldKeyFromLabel, movedIds, optionsFromLines } from '@/features/settings/field-key.ts';

describe('field keys', () => {
  test('turn labels into keys the server accepts', () => {
    expect(fieldKeyFromLabel('Deal size')).toBe('deal_size');
    expect(fieldKeyFromLabel('2025 budget')).toBe('field_2025_budget');
    expect(fieldKeyFromLabel('Ünicode Ärger')).toBe('unicode_arger');
    expect(fieldKeyFromLabel('!!!')).toBe('field');
  });

  test('a long label is cut to the key limit without a trailing underscore', () => {
    const key = fieldKeyFromLabel(`${'a'.repeat(39)} b`);
    expect(key).toBe('a'.repeat(39));
    expect(fieldKeyFromLabel('x'.repeat(60))).toHaveLength(40);
  });

  test('options come one per line without duplicates', () => {
    expect(optionsFromLines('SaaS\nAgency\n\nSaaS')).toEqual([
      { value: 'saas', label: 'SaaS' },
      { value: 'agency', label: 'Agency' },
    ]);
  });

  test('options trim their lines and skip lines that leave nothing to use as a value', () => {
    expect(optionsFromLines('  Mid market  \n???\n')).toEqual([
      { value: 'mid-market', label: 'Mid market' },
    ]);
  });

  test('what it makes passes the schemas the server checks with', () => {
    for (const label of ['Deal size', '2025 budget', 'Ünicode Ärger', '!!!', 'x'.repeat(60)]) {
      expect(fieldKeySchema.safeParse(fieldKeyFromLabel(label)).success).toBe(true);
    }
    for (const option of optionsFromLines('Série A\nCafé & bar\nOne: two\n2025')) {
      expect(fieldOptionSchema.safeParse(option).success).toBe(true);
    }
  });

  test('movedIds swaps a stage with its neighbour and stays put at the ends', () => {
    expect(movedIds(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(movedIds(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(movedIds(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(movedIds(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});
