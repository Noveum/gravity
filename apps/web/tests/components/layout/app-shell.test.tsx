import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useEffect } from 'react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation', '@/lib/realtime/ticket.ts']);

const ticketRequests: string[] = [];
mock.module('@/lib/realtime/ticket.ts', () => ({
  fetchRealtimeTicket: (organizationId: string) => {
    ticketRequests.push(organizationId);
    return new Promise<string>(() => undefined);
  },
}));

const push = mock<(href: string) => void>();
let pathname = '/today';

mock.module('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, replace: mock(), refresh: mock(), prefetch: mock() }),
  redirect: mock(),
  notFound: mock(),
}));

const { AppShell } = await import('@/components/layout/app-shell.tsx');
const { ThemeProvider } = await import('@/components/theme-provider.tsx');
const { useContextPanel } = await import('@/lib/context-panel.tsx');
const { useCopyForAgentTarget } = await import('@/lib/copy-for-agent.tsx');
const { createQueryClient } = await import('@/lib/query/provider.tsx');
const { queryKeys } = await import('@/lib/query/keys.ts');

const realFetch = globalThis.fetch;
const requested: string[] = [];

function Peeker() {
  const { show } = useContextPanel();
  useEffect(() => show(<p>Peek body</p>, 'Lead YOD-1'), [show]);
  return null;
}

function FocusedRecord({ target }: { readonly target: string }) {
  useCopyForAgentTarget(target);
  return <p>Record body</p>;
}

function shellElement(body: ReactNode) {
  return (
    <ThemeProvider>
      <AppShell
        workspace={{ id: 'w1', name: 'Acme Studio', slug: 'acme-studio' }}
        user={{ id: 'u1', name: 'Ada Lovelace', email: 'ada@acme.test' }}
        realtimeUrl=""
        realtimeCursor={0}
      >
        {body}
      </AppShell>
    </ThemeProvider>
  );
}

async function runPaletteCommand(label: string): Promise<void> {
  await userEvent.keyboard('{Control>}k{/Control}');
  const palette = await screen.findByRole('dialog', { name: 'Command palette' });
  await userEvent.click(within(palette).getByText(label));
}

type Bootstrap = ReturnType<typeof bootstrapFixture>;

function renderShell(body: ReactNode = <p>Page body</p>, bootstrap?: Bootstrap) {
  return renderWithClient(shellElement(body), bootstrap === undefined ? {} : { bootstrap });
}

function sidebarAside(): HTMLElement {
  const aside = document.querySelector<HTMLElement>('aside');
  if (aside === null) throw new Error('missing sidebar');
  return aside;
}

afterAll(() => setViewport(false));

beforeEach(() => {
  push.mockClear();
  pathname = '/today';
  setViewport(true);
  requested.length = 0;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    requested.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not stubbed.' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe('AppShell', () => {
  test('renders the workspace, the grouped navigation and the page body', () => {
    renderShell();
    expect(screen.getAllByText('Acme Studio').length).toBeGreaterThan(0);
    const nav = screen.getAllByRole('navigation', { name: 'Workspace' })[0];
    if (nav === undefined) throw new Error('missing workspace navigation');
    for (const label of ['Today', 'Inbox', 'Meetings', 'Leads', 'People', 'Companies', 'Deals']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Page body')).toBeInTheDocument();
    expect(within(nav).getByText('Brands')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Prospecting/ })).toHaveAttribute(
      'href',
      '/leads/YOD',
    );
  });

  test('leaves the Brands section out when the workspace has no brands', () => {
    renderShell(undefined, bootstrapFixture({ brands: [], pipelines: [], stages: [] }));
    const nav = screen.getAllByRole('navigation', { name: 'Workspace' })[0];
    if (nav === undefined) throw new Error('missing workspace navigation');
    expect(within(nav).queryByText('Brands')).not.toBeInTheDocument();
  });

  test('names the brand and pipeline of a lead list in the breadcrumb', () => {
    pathname = '/leads/YOD';
    renderShell();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Yodu')).toBeInTheDocument();
    expect(within(crumbs).getByText('Prospecting')).toBeInTheDocument();
  });

  test('marks the current section and shows it in the breadcrumb', () => {
    pathname = '/people';
    renderShell();
    const nav = screen.getAllByRole('navigation', { name: 'Workspace' })[0];
    if (nav === undefined) throw new Error('missing workspace navigation');
    expect(within(nav).getByRole('link', { name: 'People' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('People')).toBeInTheDocument();
  });

  test('g then c goes to companies', async () => {
    renderShell();
    await userEvent.keyboard('gc');
    expect(push).toHaveBeenCalledWith('/companies');
  });

  test('g then comma goes to settings', async () => {
    renderShell();
    await userEvent.keyboard('g,');
    expect(push).toHaveBeenCalledWith('/settings/members');
  });

  test('mod+k opens the palette and choosing a command navigates', async () => {
    renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.click(within(palette).getByText('Go to People'));
    expect(push).toHaveBeenCalledWith('/people');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  test('typing in the palette filters the commands', async () => {
    renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.type(within(palette).getByRole('combobox'), 'compan');
    expect(within(palette).getByText('Go to Companies')).toBeInTheDocument();
    expect(within(palette).queryByText('Go to People')).not.toBeInTheDocument();
  });

  test('question mark lists the live shortcuts', async () => {
    renderShell();
    await userEvent.keyboard('?');
    const overlay = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(overlay).getByText('Go to Companies')).toBeInTheDocument();
    expect(within(overlay).getByText('Toggle sidebar')).toBeInTheDocument();
  });

  test('left bracket collapses the sidebar to icons and back', async () => {
    renderShell();
    const aside = sidebarAside();
    expect(aside.className).toContain('w-[var(--sidebar-width)]');
    await userEvent.keyboard('[[');
    expect(aside.className).toContain('w-[var(--sidebar-width-collapsed)]');
    await userEvent.keyboard('[[');
    expect(aside.className).toContain('w-[var(--sidebar-width)]');
  });

  test('left bracket leaves the sidebar alone on a record page, where it means the previous record', async () => {
    pathname = '/people/per1';
    renderShell();
    const aside = sidebarAside();
    await userEvent.keyboard('[[');
    expect(aside.className).toContain('w-[var(--sidebar-width)]');
  });

  test('starts collapsed to icons below the wide breakpoint', () => {
    setViewport(false);
    renderShell();
    expect(sidebarAside().className).toContain('w-[var(--sidebar-width-collapsed)]');
  });

  test('the collapsed sidebar shows a dot per brand behind a separator, and no separator without brands', () => {
    setViewport(false);
    const { unmount } = renderShell();
    expect(within(sidebarAside()).getByRole('link', { name: 'Yodu' })).toHaveAttribute(
      'href',
      '/leads/YOD',
    );
    expect(sidebarAside().querySelectorAll('[data-sidebar-separator]')).toHaveLength(2);
    unmount();
    renderShell(undefined, bootstrapFixture({ brands: [], pipelines: [], stages: [] }));
    expect(sidebarAside().querySelectorAll('[data-sidebar-separator]')).toHaveLength(1);
  });

  test('opens the live connection for the current workspace', async () => {
    ticketRequests.length = 0;
    renderShell();
    await waitFor(() => expect(ticketRequests).toEqual(['w1']));
  });

  test('chords are ignored while typing in a field', async () => {
    renderShell(<input aria-label="Note" />);
    await userEvent.type(screen.getByLabelText('Note'), 'gc');
    expect(push).not.toHaveBeenCalled();
  });

  test('C opens quick create from the shell and the shortcut list names it', async () => {
    renderShell();
    await userEvent.keyboard('c');
    expect(await screen.findByRole('dialog', { name: 'Add a person' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a person' })).toBeNull());
    await userEvent.keyboard('?');
    const overlay = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(overlay).getByText('Quick create')).toBeInTheDocument();
  });

  test('C types into the palette search instead of opening quick create', async () => {
    renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.keyboard('c');
    expect(screen.getByPlaceholderText('Type a command or search')).toHaveValue('c');
    expect(screen.queryByRole('dialog', { name: 'Add a person' })).toBeNull();
  });

  test('paints brand names from the hydrated bootstrap without asking the server', () => {
    const server = new QueryClient();
    server.setQueryData(queryKeys.bootstrap, bootstrapFixture());
    renderWithClient(
      <HydrationBoundary state={dehydrate(server)}>
        {shellElement(<p>Page body</p>)}
      </HydrationBoundary>,
      { bootstrap: null, client: createQueryClient() },
    );
    const nav = screen.getAllByRole('navigation', { name: 'Workspace' })[0];
    if (nav === undefined) throw new Error('missing workspace navigation');
    expect(within(nav).getByText('Yodu')).toBeInTheDocument();
    expect(requested.filter((path) => path.includes('/api/bootstrap'))).toEqual([]);
  });

  test('the palette copies the link to the current view', async () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderShell();
    await runPaletteCommand('Copy link');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
  });

  test('the palette copies the focused record for an agent, the same text as the key', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(
        Response.json({
          subject: { type: 'lead', id: 'l2' },
          label: 'YOD-2 · Ada Lovelace',
          text: 'Person: Ada Lovelace',
        }),
      );
    }) as unknown as typeof fetch;
    renderShell(<FocusedRecord target="l2" />);
    await runPaletteCommand('Copy for agent');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
    expect(requested.filter((path) => path.startsWith('/api/context'))).toEqual([
      '/api/context?ref=l2',
    ]);
    expect(await screen.findByText('Copied YOD-2 · Ada Lovelace')).toBeInTheDocument();
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]?.[0]).toBe('Person: Ada Lovelace');
  });

  test('the palette says to focus a record first when none is focused', async () => {
    renderShell();
    await runPaletteCommand('Copy for agent');
    expect(await screen.findByText('Focus a record first')).toBeInTheDocument();
    expect(requested.filter((path) => path.startsWith('/api/context'))).toEqual([]);
  });

  test('Cmd+Shift+A does nothing on a page with no record', async () => {
    renderShell();
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    expect(requested.filter((path) => path.startsWith('/api/context'))).toEqual([]);
    expect(screen.queryByText('Focus a record first')).not.toBeInTheDocument();
  });

  test('the palette toggles the context panel once it has something to show', async () => {
    renderShell(<Peeker />);
    expect(await screen.findByText('Peek body')).toBeInTheDocument();
    await runPaletteCommand('Toggle context panel');
    await waitFor(() => expect(screen.queryByText('Peek body')).not.toBeInTheDocument());
  });

  test('the palette leaves out the panel toggle when the panel is empty', async () => {
    renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByText('Copy link')).toBeInTheDocument();
    expect(within(palette).queryByText('Toggle context panel')).not.toBeInTheDocument();
  });
});
