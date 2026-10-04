import { afterEach, describe, expect, test } from 'bun:test';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpPanel } from '@/features/settings/mcp-panel.tsx';
import { installDeferredFetch } from '../../support/deferred-fetch.ts';
import { serveJson } from '../../support/fetch.ts';
import { renderWithClient } from '../../support/render.tsx';

const SERVER_URL = 'http://localhost:3300/mcp';

const CONNECTION = {
  id: 'g1',
  clientName: 'Desk agent',
  clientLogo: null,
  redirectHosts: ['127.0.0.1:4321'],
  organizationName: 'Acme Studio',
  scopes: ['openid', 'offline_access', 'gravity.read'],
  createdAt: '2026-10-01T10:00:00.000Z',
  lastUsedAt: null,
};

const SECOND = {
  ...CONNECTION,
  id: 'g2',
  clientName: 'Mail agent',
  clientLogo: 'https://agent.example.com/logo.png',
  redirectHosts: ['agent.example.com', 'cursor://anysphere.cursor-retrieval'],
  scopes: ['openid', 'gravity.read', 'gravity.approve'],
  lastUsedAt: '2026-10-03T10:00:00.000Z',
};

function isListed(name: string): boolean {
  return screen.queryByRole('listitem', { name }) !== null;
}

function isConfirming(): boolean {
  return screen.queryByRole('button', { name: 'Revoke access' }) !== null;
}

const realFetch = globalThis.fetch;
const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
  else Object.defineProperty(navigator, 'clipboard', realClipboard);
});

describe('McpPanel', () => {
  test('shows the server URL and each connection with its workspace, scopes and host', async () => {
    serveJson(() => ({ body: { connections: [CONNECTION] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    expect(screen.getByText(SERVER_URL)).toBeInTheDocument();
    const row = await screen.findByRole('listitem', { name: 'Desk agent' });
    expect(within(row).getByText('Acme Studio')).toBeInTheDocument();
    expect(within(row).getByText('gravity.read')).toBeInTheDocument();
    expect(within(row).queryByText('openid')).toBeNull();
    expect(within(row).queryByText('offline_access')).toBeNull();
    expect(within(row).getByText('Never used')).toBeInTheDocument();
    expect(within(row).getByText('127.0.0.1:4321')).toBeInTheDocument();
    expect(within(row).getByText(/Connected/)).toBeInTheDocument();
  });

  test('says that names and logos come from the app and every redirect host is listed', async () => {
    serveJson(() => ({ body: { connections: [SECOND] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    const row = await screen.findByRole('listitem', { name: 'Mail agent' });
    expect(
      screen.getByText(/provided by each app and not verified by Gravity/),
    ).toBeInTheDocument();
    expect(within(row).getByText('agent.example.com')).toBeInTheDocument();
    expect(within(row).getByText('cursor://anysphere.cursor-retrieval')).toBeInTheDocument();
    expect(within(row).getByText('gravity.approve')).toHaveClass('text-warning');
    expect(within(row).getByText(/Last used/)).toBeInTheDocument();
  });

  test('renders the logo without a referrer, and a connection with no logo gets its initial', async () => {
    serveJson(() => ({ body: { connections: [SECOND, CONNECTION] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    const withLogo = await screen.findByRole('listitem', { name: 'Mail agent' });
    const logo = within(withLogo).getByTestId('client-logo');
    expect(logo).toHaveAttribute('src', 'https://agent.example.com/logo.png');
    expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer');
    const bare = screen.getByRole('listitem', { name: 'Desk agent' });
    expect(within(bare).queryByTestId('client-logo')).toBeNull();
    expect(within(bare).getByText('D')).toBeInTheDocument();
  });

  test('never loads a logo that is not https even if the server sent one', async () => {
    serveJson(() => ({
      body: { connections: [{ ...SECOND, clientLogo: 'javascript:alert(1)' }] },
    }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await screen.findByRole('listitem', { name: 'Mail agent' });
    expect(screen.queryByTestId('client-logo')).toBeNull();
  });

  test('Escape closes the confirmation and nothing is sent', async () => {
    const sent = serveJson(() => ({ body: { connections: [CONNECTION] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(isConfirming()).toBe(false));
    expect(sent.some((entry) => entry.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('listitem', { name: 'Desk agent' })).toBeInTheDocument();
  });

  test('closing the confirmation puts focus back on the Revoke button that opened it', async () => {
    serveJson(() => ({ body: { connections: [CONNECTION, SECOND] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    const revoke = await screen.findByRole('button', { name: 'Revoke Mail agent' });
    await userEvent.click(revoke);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(revoke).toHaveFocus());
  });

  test('Cancel keeps the connection and sends nothing', async () => {
    const sent = serveJson(() => ({ body: { connections: [CONNECTION] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(isConfirming()).toBe(false));
    expect(sent.some((entry) => entry.method === 'DELETE')).toBe(false);
  });

  test('a refusal keeps the row, shows the server message and offers no Retry', async () => {
    serveJson((_url, method) =>
      method === 'DELETE'
        ? {
            status: 403,
            body: { error: { code: 'forbidden', message: 'You cannot revoke that connection.' } },
          }
        : { body: { connections: [CONNECTION] } },
    );
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(await screen.findByText('Could not revoke Desk agent')).toBeInTheDocument();
    expect(screen.getByText('You cannot revoke that connection.')).toBeInTheDocument();
    expect(screen.queryByTestId('toast-action')).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Desk agent' })).toBeInTheDocument();
  });

  test('a server failure keeps the row and Retry sends the revoke again', async () => {
    let attempts = 0;
    const sent = serveJson((_url, method) => {
      if (method !== 'DELETE') return { body: { connections: attempts > 1 ? [] : [CONNECTION] } };
      attempts += 1;
      return attempts === 1
        ? { status: 500, body: { error: { code: 'internal', message: 'Something broke.' } } }
        : { body: { ok: true } };
    });
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(await screen.findByText('Could not revoke Desk agent')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Desk agent' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('toast-action'));
    await waitFor(() => expect(isListed('Desk agent')).toBe(false));
    expect(sent.filter((entry) => entry.method === 'DELETE')).toHaveLength(2);
  });

  test('a connection that is already gone leaves the list when the server says so', async () => {
    let gone = false;
    serveJson((_url, method) => {
      if (method === 'DELETE') {
        gone = true;
        return {
          status: 404,
          body: { error: { code: 'not_found', message: 'That connection does not exist.' } },
        };
      }
      return { body: { connections: gone ? [] : [CONNECTION] } };
    });
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(isListed('Desk agent')).toBe(false));
    expect(screen.getByText('That connection does not exist.')).toBeInTheDocument();
  });

  test('focus moves to the next connection when the focused one is removed', async () => {
    let revoked = false;
    serveJson((_url, method) => {
      if (method === 'DELETE') {
        revoked = true;
        return { body: { ok: true } };
      }
      return { body: { connections: revoked ? [SECOND] : [CONNECTION, SECOND] } };
    });
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(isListed('Desk agent')).toBe(false));
    expect(screen.getByRole('button', { name: 'Revoke Mail agent' })).toHaveFocus();
  });

  test('says how to connect when there are no connections', async () => {
    serveJson(() => ({ body: { connections: [] } }));
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    expect(await screen.findByText('No agents are connected yet.')).toBeInTheDocument();
    expect(screen.getByText(SERVER_URL)).toBeInTheDocument();
  });

  test('names what failed to load and Retry loads it again', async () => {
    let calls = 0;
    serveJson(() => {
      calls += 1;
      return calls === 1
        ? { status: 500, body: { error: { code: 'internal', message: 'Down.' } } }
        : { body: { connections: [CONNECTION] } };
    });
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    expect(await screen.findByText('Could not load your MCP clients')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('listitem', { name: 'Desk agent' })).toBeInTheDocument();
  });

  test('copies the server URL', async () => {
    serveJson(() => ({ body: { connections: [] } }));
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy server URL' }));
    await waitFor(() => expect(copied).toEqual([SERVER_URL]));
    expect(await screen.findByText('Server URL copied')).toBeInTheDocument();
  });

  test('a stale list is refetched when the page is opened again', async () => {
    let calls = 0;
    serveJson(() => {
      calls += 1;
      return { body: { connections: [CONNECTION] } };
    });
    const first = renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await screen.findByRole('listitem', { name: 'Desk agent' });
    first.unmount();
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />, { client: first.client });
    await waitFor(() => expect(calls).toBe(2));
  });
});

describe('McpPanel revocation', () => {
  const wire = installDeferredFetch();

  test('keeps the row until the server has confirmed, then removes it', async () => {
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await waitFor(() => expect(wire.waiting()).toBe(1));
    act(() => wire.answer(200, { connections: [CONNECTION, SECOND] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(wire.waiting()).toBe(1));
    expect(wire.sent.at(-1)).toMatchObject({ path: '/api/mcp-grants/g1', method: 'DELETE' });
    const pending = screen.getByRole('listitem', { name: 'Desk agent' });
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(within(pending).getByRole('button', { name: 'Revoke Desk agent' })).toBeEnabled();
    act(() => wire.answer(200, { ok: true }));
    await waitFor(() => expect(isListed('Desk agent')).toBe(false));
    expect(screen.getByRole('listitem', { name: 'Mail agent' })).toBeInTheDocument();
    expect(screen.getByText('Revoked Desk agent')).toBeInTheDocument();
  });

  test('a refusal leaves the row in place', async () => {
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await waitFor(() => expect(wire.waiting()).toBe(1));
    act(() => wire.answer(200, { connections: [CONNECTION] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(wire.waiting()).toBe(1));
    act(() =>
      wire.answer(403, { error: { code: 'forbidden', message: 'You cannot revoke that.' } }),
    );
    expect(await screen.findByText('You cannot revoke that.')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Desk agent' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Desk agent' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  test('a second confirmation while the first is in flight sends nothing more', async () => {
    renderWithClient(<McpPanel serverUrl={SERVER_URL} />);
    await waitFor(() => expect(wire.waiting()).toBe(1));
    act(() => wire.answer(200, { connections: [CONNECTION] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(wire.waiting()).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Desk agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(wire.sent.filter((entry) => entry.method === 'DELETE')).toHaveLength(1);
    act(() => wire.answer(200, { ok: true }));
    await waitFor(() => expect(isListed('Desk agent')).toBe(false));
  });
});
