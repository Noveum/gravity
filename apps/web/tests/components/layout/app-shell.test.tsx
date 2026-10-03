import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
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

type Bootstrap = ReturnType<typeof bootstrapFixture>;

function renderShell(body: ReactNode = <p>Page body</p>, bootstrap?: Bootstrap) {
  return renderWithClient(
    <ThemeProvider>
      <AppShell
        workspace={{ id: 'w1', name: 'Acme Studio', slug: 'acme-studio' }}
        user={{ id: 'u1', name: 'Ada Lovelace', email: 'ada@acme.test' }}
        realtimeUrl=""
        realtimeCursor={0}
      >
        {body}
      </AppShell>
    </ThemeProvider>,
    bootstrap === undefined ? {} : { bootstrap },
  );
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
});
