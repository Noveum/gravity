import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

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
  useRouter: () => ({ push, replace: mock(), refresh: mock(), prefetch: mock() }),
  redirect: mock(),
  notFound: mock(),
}));

const { AppShell } = await import('@/components/layout/app-shell.tsx');
const { Providers } = await import('../../../src/app/providers.tsx');

function renderShell() {
  return render(
    <Providers>
      <AppShell
        workspace={{ id: 'w1', name: 'Acme Studio', slug: 'acme-studio' }}
        user={{ id: 'u1', name: 'Ada Lovelace', email: 'ada@acme.test' }}
        realtimeUrl=""
      >
        <p>Page body</p>
      </AppShell>
    </Providers>,
  );
}

function setViewport(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: mock(),
      removeEventListener: mock(),
      addListener: mock(),
      removeListener: mock(),
      dispatchEvent: mock(),
    }),
  });
}

beforeEach(() => {
  push.mockClear();
  pathname = '/today';
  setViewport(true);
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
    expect(screen.queryByText('Brands')).not.toBeInTheDocument();
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
    const aside = document.querySelector('aside');
    if (aside === null) throw new Error('missing sidebar');
    expect(aside.className).toContain('w-[var(--sidebar-width)]');
    await userEvent.keyboard('[[');
    expect(aside.className).toContain('w-[var(--sidebar-width-collapsed)]');
    await userEvent.keyboard('[[');
    expect(aside.className).toContain('w-[var(--sidebar-width)]');
  });

  test('starts collapsed to icons below the wide breakpoint', () => {
    setViewport(false);
    renderShell();
    const aside = document.querySelector('aside');
    expect(aside?.className).toContain('w-[var(--sidebar-width-collapsed)]');
  });

  test('opens the live connection for the current workspace', async () => {
    ticketRequests.length = 0;
    renderShell();
    await waitFor(() => expect(ticketRequests).toEqual(['w1']));
  });

  test('chords are ignored while typing in a field', async () => {
    render(
      <Providers>
        <AppShell
          workspace={{ id: 'w1', name: 'Acme Studio', slug: 'acme-studio' }}
          user={{ id: 'u1', name: 'Ada Lovelace', email: 'ada@acme.test' }}
          realtimeUrl=""
        >
          <input aria-label="Note" />
        </AppShell>
      </Providers>,
    );
    await userEvent.type(screen.getByLabelText('Note'), 'gc');
    expect(push).not.toHaveBeenCalled();
  });
});
