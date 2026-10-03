import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, screen, within } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
mockNavigation('/leads/YOD');
stubLayoutSize(1200, 800);

const { LeadsView } = await import('@/features/leads/leads-view.tsx');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { placeLead } = await import('@/lib/query/lead-cache.ts');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

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
    act(() => placeLead(client, arrival));
    expect(await screen.findByTestId('lead-row-YOD-2')).toBeInTheDocument();
    expect(screen.getByTestId('stage-group-New')).toHaveTextContent('2');

    act(() => placeLead(client, { ...arrival, stageId: 'ready', syncId: 21 }));
    const ready = await screen.findByTestId('stage-group-Ready');
    expect(ready).toHaveTextContent('1');
    expect(screen.getByTestId('stage-group-New')).toHaveTextContent('1');
    expect(within(screen.getByTestId('lead-list')).getAllByTestId(/^lead-row-/)).toHaveLength(2);
  });
});
