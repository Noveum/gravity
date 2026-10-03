import { mock } from 'bun:test';

export interface Served {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

export interface Reply {
  readonly status?: number;
  readonly body: unknown;
}

export function serveJson(handler: (url: URL, method: string, body: unknown) => Reply): Served[] {
  const sent: Served[] = [];
  globalThis.fetch = mock((input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost:3300');
    const method = init.method ?? 'GET';
    const body: unknown = init.body === undefined ? undefined : JSON.parse(String(init.body));
    sent.push({ url: `${url.pathname}${url.search}`, method, body });
    const reply = handler(url, method, body);
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}
