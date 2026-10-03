import { afterEach, beforeEach, mock } from 'bun:test';

export interface SentRequest {
  readonly path: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

export interface DeferredFetch {
  readonly sent: readonly SentRequest[];
  readonly waiting: () => number;
  readonly answer: (status: number, body: unknown) => void;
}

export function installDeferredFetch(): DeferredFetch {
  const realFetch = globalThis.fetch;
  const sent: SentRequest[] = [];
  const pending: ((response: Response) => void)[] = [];

  beforeEach(() => {
    sent.length = 0;
    pending.length = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      sent.push({ path: String(input), method: init?.method, body });
      return new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  return {
    sent,
    waiting: () => pending.length,
    answer: (status, body) => {
      const next = pending.shift();
      if (next === undefined) throw new Error('No request is waiting for an answer.');
      next(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}
