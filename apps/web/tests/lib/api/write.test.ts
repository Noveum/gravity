import { describe, expect, test } from 'bun:test';
import { originClientIdOf } from '@/lib/api/write.ts';

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost:3300/api/leads', { method: 'POST', headers });
}

describe('originClientIdOf', () => {
  test('reads the client id header', () => {
    expect(originClientIdOf(request({ 'x-gravity-client-id': 'tab-1' }))).toBe('tab-1');
  });

  test('ignores a missing or oversized header', () => {
    expect(originClientIdOf(request({}))).toBeUndefined();
    expect(originClientIdOf(request({ 'x-gravity-client-id': 'x'.repeat(65) }))).toBeUndefined();
  });
});
