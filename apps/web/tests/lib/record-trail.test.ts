import { describe, expect, test } from 'bun:test';
import { neighbourOf, setLeadTrail, setRecordTrail, trailHref } from '@/lib/record-trail.ts';

describe('record trail', () => {
  test('steps through the list the record was opened from', () => {
    setRecordTrail('/people', ['a', 'b', 'b', 'c']);
    expect(neighbourOf('/people', 'b', 1)).toBe('c');
    expect(neighbourOf('/people', 'b', -1)).toBe('a');
    expect(neighbourOf('/people', 'c', 1)).toBeNull();
    expect(neighbourOf('/people', 'a', -1)).toBeNull();
    expect(neighbourOf('/people', 'z', 1)).toBeNull();
    expect(neighbourOf('/companies', 'b', 1)).toBeNull();
    expect(trailHref('/people', 'c')).toBe('/people/c');
  });

  test('a lead trail steps through people and keeps the lead each row stood for', () => {
    setLeadTrail([
      { personId: 'p1', id: 'l1' },
      { personId: 'p2', id: 'l2' },
      { personId: 'p1', id: 'l3' },
      { personId: 'p3', id: 'l4' },
    ]);
    expect(neighbourOf('/people', 'p1', 1)).toBe('p2');
    expect(neighbourOf('/people', 'p2', 1)).toBe('p3');
    expect(trailHref('/people', 'p1')).toBe('/people/p1?lead=l1');
    expect(trailHref('/people', 'p3')).toBe('/people/p3?lead=l4');
  });

  test('a new trail replaces the old one', () => {
    setLeadTrail([{ personId: 'p1', id: 'l1' }]);
    setRecordTrail('/companies', ['c1', 'c2']);
    expect(neighbourOf('/people', 'p1', 1)).toBeNull();
    expect(trailHref('/people', 'p1')).toBe('/people/p1');
    expect(neighbourOf('/companies', 'c1', 1)).toBe('c2');
  });
});
