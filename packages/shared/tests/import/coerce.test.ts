import { describe, expect, test } from 'bun:test';
import { booleanOf, coerceFieldValue, instantOf } from '../../src/import/coerce.ts';

const select = {
  key: 'seniority',
  type: 'select' as const,
  options: [
    { value: 'junior', label: 'Junior' },
    { value: 'senior', label: 'Senior' },
  ],
};

const number = { key: 'n', type: 'number' as const, options: [] };
const date = { key: 'd', type: 'date' as const, options: [] };

describe('coerceFieldValue', () => {
  test('turns text into each field type', () => {
    expect(coerceFieldValue(number, '1,200')).toEqual({ ok: true, value: 1200 });
    expect(coerceFieldValue({ key: 'b', type: 'boolean', options: [] }, 'Yes')).toEqual({
      ok: true,
      value: true,
    });
    expect(coerceFieldValue(date, '2031-03-04')).toEqual({ ok: true, value: '2031-03-04' });
    expect(coerceFieldValue(select, 'Senior')).toEqual({ ok: true, value: 'senior' });
    expect(coerceFieldValue({ ...select, type: 'multi_select' }, 'junior; Senior')).toEqual({
      ok: true,
      value: ['junior', 'senior'],
    });
  });

  test('explains what does not fit', () => {
    expect(coerceFieldValue(number, 'many')).toEqual({
      ok: false,
      message: 'many is not a number.',
    });
    expect(coerceFieldValue({ key: 'b', type: 'boolean', options: [] }, 'maybe')).toEqual({
      ok: false,
      message: 'Use yes or no, not maybe.',
    });
    const refused = coerceFieldValue(select, 'Principal');
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.message : '').toBe('Pick one of: junior, senior.');
  });

  test('reads numbers strictly', () => {
    expect(coerceFieldValue(number, '-3.5')).toEqual({ ok: true, value: -3.5 });
    expect(coerceFieldValue(number, '1,234,567.5')).toEqual({ ok: true, value: 1234567.5 });
    for (const text of ['1,5', '0x10', '1e3', 'Infinity', '--1', '1.', '1,23', '9'.repeat(400)]) {
      expect(coerceFieldValue(number, text).ok).toBe(false);
    }
  });

  test('reads dates as ISO days only, whatever the machine time zone', () => {
    expect(coerceFieldValue(date, '2031-03-04T23:30:00-05:00')).toEqual({
      ok: true,
      value: '2031-03-04',
    });
    for (const text of ['03/04/2031', '2031-02-30', 'March 4 2031', 'someday', '0000-01-01']) {
      expect(coerceFieldValue(date, text).ok).toBe(false);
    }
  });

  test('keeps a multi choice free of repeats', () => {
    expect(coerceFieldValue({ ...select, type: 'multi_select' }, 'junior, Junior;JUNIOR')).toEqual({
      ok: true,
      value: ['junior'],
    });
  });

  test('keeps formula looking text verbatim and lets the url schema refuse a script', () => {
    expect(coerceFieldValue({ key: 't', type: 'text', options: [] }, '=1+1')).toEqual({
      ok: true,
      value: '=1+1',
    });
    expect(coerceFieldValue({ key: 'u', type: 'url', options: [] }, 'javascript:alert(1)').ok).toBe(
      false,
    );
  });

  test('an empty cell is no value', () => {
    expect(coerceFieldValue(number, '  ')).toEqual({ ok: true, value: null });
  });

  test('booleanOf reads common spellings', () => {
    expect([booleanOf('y'), booleanOf('FALSE'), booleanOf('0'), booleanOf('sure')]).toEqual([
      true,
      false,
      false,
      null,
    ]);
  });
});

describe('instantOf', () => {
  test('reads ISO days and datetimes as UTC unless an offset is given', () => {
    expect(instantOf('2031-03-04')).toBe('2031-03-04T00:00:00.000Z');
    expect(instantOf('2031-03-04T10:30')).toBe('2031-03-04T10:30:00.000Z');
    expect(instantOf('2031-03-04 10:30:15.5')).toBe('2031-03-04T10:30:15.500Z');
    expect(instantOf('2031-03-04T10:00:00+02:00')).toBe('2031-03-04T08:00:00.000Z');
    expect(instantOf('2031-03-04T10:00:00Z')).toBe('2031-03-04T10:00:00.000Z');
  });

  test('refuses anything a browser and a server might read differently', () => {
    for (const text of [
      '03/04/2031',
      '2031-02-30',
      '2031-13-01',
      '2031-03-04T25:00',
      '2031-03-04T10:61',
      'Mar 4 2031',
      'someday',
      '',
      '0000-01-01',
    ]) {
      expect(instantOf(text)).toBeNull();
    }
  });
});
