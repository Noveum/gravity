import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
mockNavigation('/leads/YOD');
stubLayoutSize(1200, 800);

const { LeadsView } = await import('@/features/leads/leads-view.tsx');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { ContextPanel } = await import('@/components/layout/context-panel.tsx');
const { placeLead, removeLead } = await import('@/lib/query/lead-cache.ts');

const realFetch = globalThis.fetch;
beforeEach(() => setViewport(true));
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
    await waitFor(() => expect(screen.queryByTestId('lead-row-YOD-2')).not.toBeInTheDocument());
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
    await waitFor(() => expect(screen.queryByTestId('lead-row-YOD-2')).not.toBeInTheDocument());
    const [, second] = rows;
    if (second === undefined) throw new Error('fixture lead');
    act(() => placeLead(client, { ...second, syncId: 40 }));
    expect(await screen.findByTestId('lead-row-YOD-2')).not.toHaveAttribute('data-selected');
  });
});
