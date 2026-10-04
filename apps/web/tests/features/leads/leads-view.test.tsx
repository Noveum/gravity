import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  emptyFilterGroup,
  encodeFilter,
  inCondition,
  replaceCondition,
} from '@gravity/shared/filters';
import { act, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation, watchHistoryReplace } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport, setViewportWidth } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');
const replaced = watchHistoryReplace(navigation);
stubLayoutSize(1200, 800);

const { LeadsView } = await import('@/features/leads/leads-view.tsx');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { ContextPanel } = await import('@/components/layout/context-panel.tsx');
const { placeLead, removeLead } = await import('@/lib/query/lead-cache.ts');

const realFetch = globalThis.fetch;
beforeEach(() => {
  setViewport(true);
  navigation.search = '';
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => setViewport(false));

function serve(status: number, body: unknown, delayMs = 0): void {
  globalThis.fetch = mock(
    () =>
      new Promise<Response>((resolve) => {
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { 'content-type': 'application/json' },
              }),
            ),
          delayMs,
        );
      }),
  ) as unknown as typeof fetch;
}

function renderView(pipelineKey = 'YOD') {
  return renderWithClient(
    <ContextPanelProvider>
      <LeadsView pipelineKey={pipelineKey} />
      <ContextPanel />
    </ContextPanelProvider>,
  );
}

describe('LeadsView states', () => {
  test('an empty pipeline says what fills it', async () => {
    serve(200, { leads: [], nextCursor: null });
    renderView();
    expect(await screen.findByText('No leads in Yodu · Prospecting yet.')).toBeInTheDocument();
    expect(screen.getByText('Press C to add a person, or import a CSV.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a file' })).toHaveAttribute(
      'href',
      '/import?target=leads&pipeline=YOD',
    );
  });

  test('an empty pipeline offers no import to a role that cannot run one', async () => {
    serve(200, { leads: [], nextCursor: null });
    renderWithClient(
      <ContextPanelProvider>
        <LeadsView pipelineKey="YOD" />
      </ContextPanelProvider>,
      { bootstrap: bootstrapFixture({ me: { userId: 'u1', role: 'contributor' } }) },
    );
    expect(await screen.findByText('No leads in Yodu · Prospecting yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import a file' })).not.toBeInTheDocument();
  });

  test('shows nothing for the first 300ms, then a skeleton', async () => {
    serve(200, { leads: [], nextCursor: null }, 1_000);
    renderView();
    expect(screen.queryByTestId('list-skeleton')).not.toBeInTheDocument();
    expect(await screen.findByTestId('list-skeleton', {}, { timeout: 800 })).toBeInTheDocument();
  });

  test('a failed load names what failed and offers Retry', async () => {
    serve(500, { error: { code: 'internal', message: 'The database did not answer.' } });
    renderView();
    expect(await screen.findByText('Could not load the leads')).toBeInTheDocument();
    expect(screen.getByText('The database did not answer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  test('a lowercase pipeline key resolves to the pipeline', async () => {
    serve(200, { leads: [], nextCursor: null });
    renderView('yod');
    expect(await screen.findByText('No leads in Yodu · Prospecting yet.')).toBeInTheDocument();
  });
});

describe('LeadsView background refetch', () => {
  test('a failed refetch keeps the visible list and says so in a toast', async () => {
    serve(200, {
      leads: [leadFixture({ id: 'l1', key: 'YOD-1', personName: 'Ada Lovelace' })],
      nextCursor: null,
    });
    const { client } = renderView();
    await screen.findByTestId('lead-row-YOD-1');
    serve(500, { error: { code: 'internal', message: 'The database did not answer.' } });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['leads'] });
    });
    expect(await screen.findByText('Could not refresh the leads')).toBeInTheDocument();
    expect(screen.getByTestId('lead-row-YOD-1')).toBeInTheDocument();
    expect(screen.queryByText('Could not load the leads')).not.toBeInTheDocument();
  });
});

describe('LeadsView live updates', () => {
  test('a lead that arrives by delta appears, and a stage change regroups it', async () => {
    serve(200, {
      leads: [leadFixture({ id: 'l1', key: 'YOD-1', personName: 'Ada Lovelace' })],
      nextCursor: null,
    });
    const { client } = renderView();
    await screen.findByTestId('lead-row-YOD-1');
    expect(screen.getByTestId('stage-group-New')).toHaveTextContent('1');

    const arrival = leadFixture({
      id: 'l2',
      key: 'YOD-2',
      number: 2,
      personId: 'per2',
      personName: 'Grace Hopper',
      syncId: 20,
    });
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-active', 'true');
    act(() => placeLead(client, arrival));
    expect(await screen.findByTestId('lead-row-YOD-2')).toBeInTheDocument();
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('lead-row-YOD-2')).not.toHaveAttribute('data-active');
    expect(screen.getByTestId('stage-group-New')).toHaveTextContent('2');

    act(() => placeLead(client, { ...arrival, stageId: 'ready', syncId: 21 }));
    const ready = await screen.findByTestId('stage-group-Ready');
    expect(ready).toHaveTextContent('1');
    expect(screen.getByTestId('stage-group-New')).toHaveTextContent('1');
    expect(within(screen.getByTestId('lead-list')).getAllByTestId(/^lead-row-/)).toHaveLength(2);
  });

  test('focus and selection stay on a lead that a delta regroups', async () => {
    const ada = leadFixture({ id: 'l1', key: 'YOD-1', number: 1, personName: 'Ada Lovelace' });
    const grace = leadFixture({
      id: 'l2',
      key: 'YOD-2',
      number: 2,
      personId: 'per2',
      personName: 'Grace Hopper',
    });
    const linus = leadFixture({
      id: 'l3',
      key: 'YOD-3',
      number: 3,
      personId: 'per3',
      personName: 'Linus Torvalds',
      stageId: 'ready',
    });
    serve(200, { leads: [ada, grace, linus], nextCursor: null });
    const { client } = renderView();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('jx');
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-active', 'true');

    act(() => placeLead(client, { ...ada, stageId: 'contacted-later', syncId: 30 }));
    act(() => placeLead(client, { ...ada, stageId: 'stage-contacted', syncId: 31 }));
    expect(await screen.findByTestId('stage-group-Contacted')).toHaveTextContent('1');
    const moved = screen.getByTestId('lead-row-YOD-1');
    expect(moved).toHaveAttribute('data-active', 'true');
    expect(moved).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('lead-row-YOD-2')).not.toHaveAttribute('data-active');
  });

  test('a removed focused lead hands the focus and the peek to its neighbour', async () => {
    const rows = [1, 2, 3].map((number) =>
      leadFixture({
        id: `l${number}`,
        key: `YOD-${number}`,
        number,
        personId: `per${number}`,
        personName: `Person ${number}`,
      }),
    );
    serve(200, { leads: rows, nextCursor: null });
    globalThis.fetch = mock((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).startsWith('/api/timeline')
              ? { activities: [], nextCursor: null }
              : { leads: rows, nextCursor: null },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const { client } = renderView();
    await screen.findByTestId('lead-row-YOD-3');
    await userEvent.keyboard('j ');
    expect(screen.getByTestId('lead-row-YOD-2')).toHaveAttribute('data-active', 'true');
    await screen.findByRole('complementary', { name: 'Lead YOD-2' });
    act(() => removeLead(client, 'l2'));
    await waitForElementToBeRemoved(() => screen.queryByTestId('lead-row-YOD-2'));
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('YOD-1, Person 1');
    expect(await screen.findByRole('complementary', { name: 'Lead YOD-1' })).toBeInTheDocument();
  });

  test('a selected lead that leaves the list is dropped from the selection', async () => {
    const rows = [1, 2].map((number) =>
      leadFixture({
        id: `l${number}`,
        key: `YOD-${number}`,
        number,
        personId: `per${number}`,
        personName: `Person ${number}`,
      }),
    );
    serve(200, { leads: rows, nextCursor: null });
    const { client } = renderView();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('x');
    expect(screen.getByTestId('lead-row-YOD-2')).toHaveAttribute('data-selected', 'true');
    act(() => removeLead(client, 'l2'));
    await waitForElementToBeRemoved(() => screen.queryByTestId('lead-row-YOD-2'));
    const [, second] = rows;
    if (second === undefined) throw new Error('fixture lead');
    act(() => placeLead(client, { ...second, syncId: 40 }));
    expect(await screen.findByTestId('lead-row-YOD-2')).not.toHaveAttribute('data-selected');
  });
});

describe('LeadsView filters', () => {
  test('the toolbar stays reachable when nothing matches, and Shift+F clears', async () => {
    const filter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready']));
    navigation.search = new URLSearchParams({ filter: encodeFilter(filter), q: 'ada' }).toString();
    serve(200, { leads: [], nextCursor: null });
    renderView();
    expect(await screen.findByText('No leads match these filters.')).toBeInTheDocument();
    expect(
      screen.getByText('Press Shift+F to clear them, or change the filters above.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search this list' })).toHaveValue('ada');
    expect(screen.getByText('Stage is Ready')).toBeInTheDocument();
    await userEvent.keyboard('{Shift>}F{/Shift}');
    expect(replaced).toHaveBeenLastCalledWith('/leads/YOD');
  });

  test('Shift+F on an unfiltered list neither clears nor opens the filter menu', async () => {
    serve(200, { leads: [leadFixture()], nextCursor: null });
    renderView();
    await screen.findByTestId('lead-row-YOD-1');
    replaced.mockClear();
    await userEvent.keyboard('{Shift>}F{/Shift}');
    expect(screen.queryByPlaceholderText('Filter by')).not.toBeInTheDocument();
    expect(replaced).not.toHaveBeenCalled();
  });

  test('the list asks the server for the filter and the search term', async () => {
    const filter = replaceCondition(emptyFilterGroup(), inCondition('owner', ['me']));
    navigation.search = new URLSearchParams({ filter: encodeFilter(filter), q: 'ada' }).toString();
    serve(200, {
      leads: [leadFixture({ id: 'l1', key: 'YOD-1', personName: 'Ada Lovelace' })],
      nextCursor: null,
    });
    renderView();
    await screen.findByTestId('lead-row-YOD-1');
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const listCall = calls
      .map((call) => String(call[0]))
      .find((url) => url.startsWith('/api/leads?'));
    const params = new URLSearchParams(listCall?.split('?')[1] ?? '');
    expect(params.get('q')).toBe('ada');
    expect(params.get('filter')).toBe(encodeFilter(filter));
    expect(params.get('pipelineId')).toBe('p1');
  });
});

describe('LeadsView board', () => {
  interface Call {
    readonly url: string;
    readonly method: string;
    readonly body: unknown;
  }

  function serveLeads(rows: readonly ReturnType<typeof leadFixture>[]): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? null : (JSON.parse(String(init.body)) as unknown);
      calls.push({ url, method, body });
      const payload = url.startsWith('/api/view-preferences')
        ? { preference: body }
        : { leads: rows, nextCursor: null };
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    return calls;
  }

  function renderBoardView() {
    return renderWithClient(
      <ContextPanelProvider>
        <LeadsView pipelineKey="YOD" />
        <ContextPanel />
      </ContextPanelProvider>,
      {
        bootstrap: bootstrapFixture({
          viewPreferences: [{ page: 'leads', scope: 'p1', layout: 'board', display: {} }],
        }),
      },
    );
  }

  test('V switches to the board and back, and saves the layout for this pipeline', async () => {
    const calls = serveLeads([leadFixture()]);
    renderView();
    await screen.findByTestId('lead-row-YOD-1');
    await userEvent.keyboard('v');
    expect(await screen.findByTestId('board-card-YOD-1')).toBeInTheDocument();
    expect(screen.queryByTestId('lead-list')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
        { page: 'leads', scope: 'p1', layout: 'board', display: {} },
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(await screen.findByTestId('lead-row-YOD-1')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({
        page: 'leads',
        scope: 'p1',
        layout: 'list',
        display: {},
      }),
    );
  });

  test('a saved board layout opens on the board, empty columns included', async () => {
    serveLeads([leadFixture()]);
    renderBoardView();
    expect(await screen.findByTestId('board-card-YOD-1')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^board-column-/)).toHaveLength(13);
  });

  test('a teammate moving a lead to another stage moves its card', async () => {
    serveLeads([leadFixture()]);
    const { client } = renderBoardView();
    const card = await screen.findByTestId('board-card-YOD-1');
    expect(screen.getByTestId('board-column-New')).toContainElement(card);
    act(() => placeLead(client, leadFixture({ stageId: 'stage-contacted', syncId: 50 })));
    expect(
      await within(screen.getByTestId('board-column-Contacted')).findByTestId('board-card-YOD-1'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-active', 'true');
  });

  test('a filter that matches nothing still shows the board columns', async () => {
    const filter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready']));
    navigation.search = new URLSearchParams({ filter: encodeFilter(filter) }).toString();
    serveLeads([]);
    renderBoardView();
    expect(await screen.findAllByTestId(/^board-column-/)).toHaveLength(13);
    expect(screen.queryByText('No leads match these filters.')).not.toBeInTheDocument();
  });
});

describe('LeadsView narrow peek', () => {
  test('list keys keep working while focus is inside the peek dialog', async () => {
    const rows = [1, 2].map((number) =>
      leadFixture({
        id: `l${number}`,
        key: `YOD-${number}`,
        number,
        personId: `per${number}`,
        personName: `Person ${number}`,
      }),
    );
    globalThis.fetch = mock((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).startsWith('/api/timeline')
              ? { activities: [], nextCursor: null }
              : { leads: rows, nextCursor: null },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    setViewportWidth(600);
    renderView();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard(' ');
    const dialog = await screen.findByRole('dialog', { name: 'Lead YOD-2' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('j');
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByRole('dialog', { name: 'Lead YOD-1' })).toBeInTheDocument();
    await userEvent.keyboard('x');
    expect(screen.getByTestId('lead-row-YOD-1')).toHaveAttribute('data-selected', 'true');
  });
});
