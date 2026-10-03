import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LeadRow } from '@gravity/shared/records';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { stubLayoutProperty, stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');
stubLayoutSize(1200, 800);
afterAll(() => setViewport(false));

const { LeadList } = await import('@/features/leads/lead-list.tsx');
const { ContextPanel } = await import('@/components/layout/context-panel.tsx');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { queryKeys } = await import('@/lib/query/keys.ts');

const bootstrap = bootstrapFixture();
const pipeline = bootstrap.pipelines[0];
if (pipeline === undefined) throw new Error('fixture pipeline');
const leads = [
  leadFixture({ id: 'l1', key: 'YOD-1', number: 1, personName: 'Ada Lovelace', stageId: 'new' }),
  leadFixture({
    id: 'l2',
    key: 'YOD-2',
    number: 2,
    personName: 'Grace Hopper',
    stageId: 'new',
    personId: 'per2',
  }),
  leadFixture({
    id: 'l3',
    key: 'YOD-3',
    number: 3,
    personName: 'Linus Torvalds',
    stageId: 'ready',
    personId: 'per3',
  }),
];

function seededClient(rows: readonly LeadRow[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  client.setQueryData(queryKeys.leads(pipeline?.id ?? '', ''), {
    pages: [{ leads: rows, nextCursor: null }],
    pageParams: [null],
  });
  for (const lead of rows) {
    client.setQueryData(queryKeys.timeline('lead', lead.id, 'all'), {
      pages: [{ activities: [], nextCursor: null }],
      pageParams: [null],
    });
  }
  return client;
}

function Harness({ rows }: { readonly rows: readonly LeadRow[] }) {
  const [shown, setShown] = useState(true);
  return (
    <ContextPanelProvider>
      {shown && pipeline !== undefined ? (
        <LeadList
          pipeline={pipeline}
          stages={bootstrap.stages}
          leads={rows}
          renderActions={(selection) => (
            <span data-testid="targets">{selection.targets.map((lead) => lead.key).join(',')}</span>
          )}
        />
      ) : null}
      <button type="button" onClick={() => setShown(false)}>
        Leave the list
      </button>
      <ContextPanel />
    </ContextPanelProvider>
  );
}

function renderList(rows: readonly LeadRow[] = leads) {
  return renderWithClient(<Harness rows={rows} />, { bootstrap, client: seededClient(rows) });
}

function rowOf(key: string): HTMLElement {
  return screen.getByTestId(`lead-row-${key}`);
}

function peekPanel(): HTMLElement | null {
  return screen.queryByRole('complementary');
}

const realFetch = globalThis.fetch;
const preferenceSaved = {
  preference: {
    page: 'context-panel',
    scope: '',
    layout: 'list',
    display: { width: 420, open: true },
  },
};

beforeEach(() => {
  navigation.push.mockClear();
  setViewport(true);
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(preferenceSaved), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe('LeadList', () => {
  test('renders stage groups with counts and every lead row', async () => {
    renderList();
    expect(await screen.findByTestId('lead-row-YOD-1')).toBeInTheDocument();
    expect(screen.getByTestId('stage-group-New')).toHaveTextContent('2');
    expect(screen.getByTestId('stage-group-Ready')).toHaveTextContent('1');
  });

  test('J and K move the focus and the live region announces the row', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('j');
    expect(rowOf('YOD-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('YOD-1, Ada Lovelace');
    await userEvent.keyboard('k');
    expect(rowOf('YOD-2')).toHaveAttribute('data-active', 'true');
  });

  test('the arrow keys move the focus like J and K', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(rowOf('YOD-3')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('{ArrowUp}');
    expect(rowOf('YOD-1')).toHaveAttribute('data-active', 'true');
  });

  test('X selects, Shift+J extends, and Escape clears the selection', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('x');
    expect(rowOf('YOD-2')).toHaveAttribute('data-selected', 'true');
    await userEvent.keyboard('{Shift>}j{/Shift}');
    expect(screen.getByTestId('targets')).toHaveTextContent('YOD-2,YOD-1');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId('targets')).toHaveTextContent('YOD-1');
    expect(rowOf('YOD-2')).not.toHaveAttribute('data-selected');
  });

  test('Shift+K extends the selection upwards', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('jjx');
    await userEvent.keyboard('{Shift>}k{/Shift}');
    expect(rowOf('YOD-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('targets')).toHaveTextContent('YOD-1,YOD-3');
  });

  test('Cmd+A selects every lead in display order', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('{Meta>}a{/Meta}');
    expect(screen.getByTestId('targets')).toHaveTextContent('YOD-2,YOD-1,YOD-3');
    expect(rowOf('YOD-3')).toHaveAttribute('data-selected', 'true');
  });

  test('Space peeks into the context panel and Enter opens the record', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    const panel = await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    expect(within(panel).getByText('Grace Hopper')).toBeInTheDocument();
    expect(within(panel).getAllByText('Lead YOD-2')).toHaveLength(1);
    expect(within(panel).queryByText('YOD-2')).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/people/per2?lead=l2'));
  });

  test('O opens the focused record too', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('jo');
    expect(navigation.push).toHaveBeenCalledWith('/people/per1?lead=l1');
  });

  test('the peek follows the focus, and Space or Escape closes it', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    await userEvent.keyboard('j');
    const panel = await screen.findByRole('complementary', { name: 'Lead YOD-1' });
    expect(within(panel).getByText('Ada Lovelace')).toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(peekPanel()).not.toBeInTheDocument();
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-1' });
    await userEvent.keyboard('{Escape}');
    expect(peekPanel()).not.toBeInTheDocument();
  });

  test('a closed peek leaves nothing for ] to bring back', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    await userEvent.keyboard(' ');
    await userEvent.keyboard(']');
    expect(peekPanel()).not.toBeInTheDocument();
  });

  test('] hides the peek, J does not force it back, and ] shows the focused lead', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    await userEvent.keyboard(']');
    expect(peekPanel()).not.toBeInTheDocument();
    await userEvent.keyboard('j');
    expect(peekPanel()).not.toBeInTheDocument();
    await userEvent.keyboard(']');
    expect(await screen.findByRole('complementary', { name: 'Lead YOD-1' })).toBeInTheDocument();
  });

  test('leaving the list takes its peek with it', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    await userEvent.click(screen.getByRole('button', { name: 'Leave the list' }));
    expect(screen.queryByTestId('lead-list')).not.toBeInTheDocument();
    expect(peekPanel()).not.toBeInTheDocument();
    await userEvent.keyboard(']');
    expect(peekPanel()).not.toBeInTheDocument();
  });

  test('a plain click on a lead focuses and peeks it instead of navigating', async () => {
    renderList();
    await userEvent.click(await screen.findByRole('link', { name: /Linus Torvalds/ }));
    expect(rowOf('YOD-3')).toHaveAttribute('data-active', 'true');
    await screen.findByRole('complementary', { name: 'Lead YOD-3' });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  test('after a click on the link, Space toggles the peek and Enter opens the record', async () => {
    renderList();
    const link = await screen.findByRole('link', { name: /Linus Torvalds/ });
    await userEvent.click(link);
    await screen.findByRole('complementary', { name: 'Lead YOD-3' });
    expect(link).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(peekPanel()).not.toBeInTheDocument();
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-3' });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/people/per3?lead=l3'));
    expect(navigation.push).toHaveBeenCalledTimes(1);
  });

  test('after a click on the link, J moves on and Enter opens the new focus', async () => {
    renderList();
    const link = await screen.findByRole('link', { name: /Ada Lovelace/ });
    await userEvent.click(link);
    expect(link).toHaveFocus();
    await userEvent.keyboard('j');
    expect(rowOf('YOD-3')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/people/per3?lead=l3'));
    expect(rowOf('YOD-3')).toHaveAttribute('data-active', 'true');
  });

  test('after a click on a checkbox, Space peeks and Enter opens instead of toggling it', async () => {
    renderList();
    const checkbox = await screen.findByRole('checkbox', { name: 'Select YOD-1' });
    await userEvent.click(checkbox);
    expect(rowOf('YOD-1')).toHaveAttribute('data-selected', 'true');
    expect(rowOf('YOD-1')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-1' });
    expect(rowOf('YOD-1')).toHaveAttribute('data-selected', 'true');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/people/per1?lead=l1'));
    expect(rowOf('YOD-1')).toHaveAttribute('data-selected', 'true');
  });
});

describe('LeadList virtualization', () => {
  stubLayoutSize(1200, 140);
  stubLayoutProperty('clientHeight', 140);
  stubLayoutProperty('scrollHeight', 1712);
  const many = Array.from({ length: 60 }, (_, index) =>
    leadFixture({
      id: `m${index + 1}`,
      key: `YOD-${index + 1}`,
      number: index + 1,
      personId: `pm${index + 1}`,
      personName: `Person ${index + 1}`,
    }),
  );

  test('renders only the rows near the viewport and J scrolls the focus into view', async () => {
    renderList(many);
    await screen.findByTestId('lead-row-YOD-60');
    expect(screen.queryByTestId('lead-row-YOD-1')).not.toBeInTheDocument();
    const list = screen.getByTestId('lead-list');
    expect(list.scrollTop).toBe(0);
    await userEvent.keyboard('j'.repeat(30));
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
    fireEvent.scroll(list);
    expect(await screen.findByTestId('lead-row-YOD-30')).toHaveAttribute('data-active', 'true');
  });
});
