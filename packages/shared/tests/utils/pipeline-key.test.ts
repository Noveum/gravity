import { describe, expect, test } from 'bun:test';
import { derivePipelineKey, formatLeadKey, parseLeadKey } from '../../src/utils/pipeline-key.ts';

describe('derivePipelineKey', () => {
  test('takes the first three letters of the name', () => {
    expect(derivePipelineKey('Yodu', new Set())).toBe('YOD');
    expect(derivePipelineKey('Élan Studio', new Set())).toBe('ELA');
  });

  test('pads a short name to two letters', () => {
    expect(derivePipelineKey('Q', new Set())).toBe('QX');
    expect(derivePipelineKey('42', new Set())).toBe('XX');
  });

  test('walks past taken keys', () => {
    expect(derivePipelineKey('Yodu', new Set(['YOD']))).toBe('YODU');
    expect(derivePipelineKey('Yodu', new Set(['YOD', 'YODU']))).toBe('YOA');
  });
});

describe('lead keys', () => {
  test('format and parse round trip, case-insensitively', () => {
    expect(formatLeadKey('YOD', 142)).toBe('YOD-142');
    expect(parseLeadKey(' yod-142 ')).toEqual({ key: 'YOD', number: 142 });
  });

  test('refuse malformed keys and zero', () => {
    expect(parseLeadKey('YOD-0')).toBeNull();
    expect(parseLeadKey('Y-1')).toBeNull();
    expect(parseLeadKey('YOD142')).toBeNull();
  });
});
