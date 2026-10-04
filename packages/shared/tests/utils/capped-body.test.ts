import { describe, expect, test } from 'bun:test';
import { readCappedBytes } from '../../src/utils/capped-body.ts';

function streamed(chunks: readonly Uint8Array[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request('http://test.local/', { method: 'POST', body, duplex: 'half' } as RequestInit);
}

describe('readCappedBytes', () => {
  test('returns the bytes of a body within the limit, joined across chunks', async () => {
    const read = await readCappedBytes(streamed([new Uint8Array([1, 2]), new Uint8Array([3])]), 3);
    expect([...(read ?? [])]).toEqual([1, 2, 3]);
  });

  test('refuses a declared length over the limit without reading the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(11));
        controller.close();
      },
    });
    const request = new Request('http://test.local/', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { 'content-length': '11' },
    } as RequestInit);
    expect(await readCappedBytes(request, 10)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  test('refuses a streamed body that grows past the limit', async () => {
    const chunk = new Uint8Array(6);
    expect(await readCappedBytes(streamed([chunk, chunk]), 10)).toBeNull();
  });

  test('an empty body is empty bytes', async () => {
    const read = await readCappedBytes(new Request('http://test.local/'), 10);
    expect(read?.byteLength).toBe(0);
  });
});
