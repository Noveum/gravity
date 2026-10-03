import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['next/navigation']);

const push = mock<(href: string) => void>();
const refresh = mock();
mock.module('next/navigation', () => ({
  usePathname: () => '/invite/abc',
  useRouter: () => ({ push, replace: mock(), refresh, prefetch: mock() }),
  redirect: mock(),
  notFound: mock(),
}));

const { InviteAccept } = await import('@/features/settings/invite-accept.tsx');

const requests: { path: string; method: string | undefined }[] = [];
const savedFetch = globalThis.fetch;
let reply: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { organizationId: 'o1', alreadyAccepted: false },
};

beforeEach(() => {
  requests.length = 0;
  push.mockClear();
  refresh.mockClear();
  reply = { ok: true, status: 200, body: { organizationId: 'o1', alreadyAccepted: false } };
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ path: String(input), method: init?.method });
    return Promise.resolve({
      ok: reply.ok,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe('InviteAccept', () => {
  test('posts to the accept route with the raw token and goes to today', async () => {
    render(<InviteAccept token="raw-token-123" workspaceName="Acme" />);
    await userEvent.click(screen.getByRole('button', { name: 'Join Acme' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/today'));
    expect(requests).toEqual([{ path: '/api/invites/accept/raw-token-123', method: 'POST' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('shows the server message and stays put when acceptance fails', async () => {
    reply = {
      ok: false,
      status: 409,
      body: { error: { code: 'conflict', message: 'That invite has expired.' } },
    };
    render(<InviteAccept token="raw-token-123" workspaceName="Acme" />);
    await userEvent.click(screen.getByRole('button', { name: 'Join Acme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That invite has expired.');
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Join Acme' })).toBeEnabled();
  });
});
