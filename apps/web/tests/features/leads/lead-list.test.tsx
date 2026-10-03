import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
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

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  client.setQueryData(queryKeys.leads(pipeline?.id ?? '', ''), {
    pages: [{ leads, nextCursor: null }],
    pageParams: [null],
  });
  for (const lead of leads) {
    client.setQueryData(queryKeys.timeline('lead', lead.id, 'all'), {
      pages: [{ activities: [], nextCursor: null }],
      pageParams: [null],
    });
  }
  return client;
}

function renderList() {
  renderWithClient(
    <ContextPanelProvider>
      {pipeline === undefined ? null : (
        <LeadList
          pipeline={pipeline}
          stages={bootstrap.stages}
          leads={leads}
          renderActions={(selection) => (
            <span data-testid="targets">{selection.targets.map((lead) => lead.key).join(',')}</span>
          )}
        />
      )}
      <ContextPanel />
    </ContextPanelProvider>,
    { bootstrap, client: seededClient() },
  );
}

beforeEach(() => {
  navigation.push.mockClear();
  setViewport(true);
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
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('YOD-1, Ada Lovelace');
    await userEvent.keyboard('k');
    expect(screen.getByTestId('lead-row-YOD-2')).toHaveAttribute('data-active', 'true');
  });

  test('X selects, Shift+J extends, and Escape clears the selection', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('x');
    expect(screen.getByTestId('lead-row-YOD-2')).toHaveAttribute('data-selected', 'true');
    await userEvent.keyboard('{Shift>}j{/Shift}');
    expect(screen.getByTestId('targets')).toHaveTextContent('YOD-2,YOD-1');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId('targets')).toHaveTextContent('YOD-1');
    expect(screen.getByTestId('lead-row-YOD-2')).not.toHaveAttribute('data-selected');
  });

  test('Space peeks into the context panel and Enter opens the record', async () => {
    renderList();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    const panel = await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    expect(within(panel).getByText('Grace Hopper')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/people/per2?lead=l2'));
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
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await userEvent.keyboard(' ');
    await screen.findByRole('complementary', { name: 'Lead YOD-1' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  test('a plain click on a lead focuses and peeks it instead of navigating', async () => {
    renderList();
    await userEvent.click(await screen.findByRole('link', { name: /Linus Torvalds/ }));
    expect(screen.getByTestId('lead-row-YOD-3')).toHaveAttribute('data-active', 'true');
    await screen.findByRole('complementary', { name: 'Lead YOD-3' });
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
