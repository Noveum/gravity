import { describe, expect, test } from 'bun:test';
import { DomainError } from '@gravity/shared/errors';
import { decodeCursor, encodeCursor } from '../../src/crm/cursor.ts';

describe('cursors', () => {
  test('round trip strings and numbers', () => {
    expect(decodeCursor(encodeCursor(['ada', 7]), 2)).toEqual(['ada', 7]);
  });

  test('refuse the wrong length with a 422', () => {
    expect(() => decodeCursor(encodeCursor(['ada']), 2)).toThrow(DomainError);
    expect(() => decodeCursor(encodeCursor(['ada']), 2)).toThrow(
      'That page cursor is not valid. Reload the list.',
    );
  });

  test('refuse garbage with a 422', () => {
    expect(() => decodeCursor('%%%', 1)).toThrow(DomainError);
    expect(() => decodeCursor(Buffer.from('{"a":1}').toString('base64url'), 1)).toThrow(
      DomainError,
    );
    let status = 0;
    try {
      decodeCursor('%%%', 1);
    } catch (error: unknown) {
      status = error instanceof DomainError ? error.status : -1;
    }
    expect(status).toBe(422);
  });
});
