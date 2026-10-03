import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LeadRow, PipelineRow } from '@gravity/shared/records';
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
stubLayoutSize(1400, 800);
afterAll(() => setViewport(false));

const { LeadBoard } = await import('@/features/leads/lead-board.tsx');
const { LeadUndoHotkeys, clearLeadHistory } = await import('@/features/leads/lead-undo.ts');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { ContextPanel } = await import('@/components/layout/context-panel.tsx');

const bootstrap = bootstrapFixture();
const [fixturePipeline] = bootstrap.pipelines;
if (fixturePipeline === undefined) throw new Error('fixture pipeline');
const pipeline: PipelineRow = fixturePipeline;
const realFetch = globalThis.fetch;

interface Sent {
  readonly url: string;
  readonly body: unknown;
}
const sent: Sent[] = [];

const ada = leadFixture({ id: 'l1', key: 'YOD-1', number: 1 });
const grace = leadFixture({
  id: 'l2',
  key: 'YOD-2',
  number: 2,
  personId: 'per2',
  personName: 'Grace Hopper',
});
const alan = leadFixture({
  id: 'l3',
  key: 'YOD-3',
  number: 3,
  personId: 'per3',
  personName: 'Alan Turing',
  stageId: 'ready',
});

beforeEach(() => {
  sent.length = 0;
  clearLeadHistory();
  navigation.push.mockClear();
  setViewport(true);
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      type?: string;
      patch?: { stageId?: string };
      stageId?: string;
    };
    sent.push({ url, body });
    const id = url.split('/').at(-1) ?? 'l1';
    const stageId = body.patch?.stageId ?? body.stageId ?? 'new';
    const lead = leadFixture({ id, stageId, syncId: 90 + sent.length });
    return Promise.resolve(
      new Response(JSON.stringify({ lead }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderBoard(leads: readonly LeadRow[] = [leadFixture()]) {
  return renderWithClient(
    <ContextPanelProvider>
      <LeadUndoHotkeys workspaceId="o1" />
      <LeadBoard pipeline={pipeline} stages={bootstrap.stages} leads={leads} />
    </ContextPanelProvider>,
    { bootstrap },
  );
}

describe('LeadBoard', () => {
  test('renders one column per stage with the card in its stage', async () => {
    renderBoard();
    expect(await screen.findAllByTestId(/^board-column-/)).toHaveLength(13);
    expect(screen.getByTestId('board-column-New')).toContainElement(
      screen.getByTestId('board-card-YOD-1'),
    );
    expect(within(screen.getByTestId('board-column-New')).getByText('1')).toBeInTheDocument();
  });

  test('Shift+Right moves the focused card one stage on', async () => {
    renderBoard();
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      url: '/api/leads/l1',
      body: { type: 'update', patch: { stageId: 'stage-researching' } },
    });
  });

  test('Shift+Left moves the focused card one stage back, and not past the first', async () => {
    renderBoard([alan]);
    await screen.findByTestId('board-card-YOD-3');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ type: 'update', patch: { stageId: 'stage-researching' } });
  });

  test('moving onto a closing stage closes the lead', async () => {
    renderBoard([leadFixture({ stageId: 'stage-meeting-held' })]);
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ type: 'close', stageId: 'stage-qualified' });
  });

  test('moving into the hold stage asks for a reason first, then holds', async () => {
    renderBoard([leadFixture({ stageId: 'stage-qualified', stageCategory: 'won' })]);
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    const reason = await screen.findByLabelText('Reason');
    expect(sent).toHaveLength(0);
    await userEvent.type(reason, 'Back in spring{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ type: 'hold', reason: 'Back in spring' });
  });

  test('Cmd+Z undoes a board move', async () => {
    renderBoard();
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({
      url: '/api/leads/l1',
      body: { type: 'update', patch: { stageId: 'new' } },
    });
    expect(await screen.findByText('Undid: Moved YOD-1 to Researching')).toBeInTheDocument();
  });

  test('J and K move within a column, the arrows move across columns', async () => {
    renderBoard([ada, grace, alan]);
    const first = await screen.findByTestId('board-card-YOD-2');
    expect(first).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('j');
    expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('j');
    expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('board-card-YOD-3')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('board-card-YOD-3')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('board-card-YOD-2')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('j');
    expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('k');
    expect(screen.getByTestId('board-card-YOD-2')).toHaveAttribute('data-active', 'true');
  });

  test('Space peeks the focused card and Enter opens its record', async () => {
    renderWithClient(
      <ContextPanelProvider>
        <LeadBoard pipeline={pipeline} stages={bootstrap.stages} leads={[ada, grace]} />
        <ContextPanel />
      </ContextPanelProvider>,
      { bootstrap },
    );
    await screen.findByTestId('board-card-YOD-2');
    await userEvent.keyboard('j ');
    expect(await screen.findByRole('complementary', { name: 'Lead YOD-1' })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(navigation.push).toHaveBeenCalledWith('/people/per1?lead=l1');
  });

  test('a plain click on a card focuses and peeks it', async () => {
    renderWithClient(
      <ContextPanelProvider>
        <LeadBoard pipeline={pipeline} stages={bootstrap.stages} leads={[ada, grace]} />
        <ContextPanel />
      </ContextPanelProvider>,
      { bootstrap },
    );
    await userEvent.click(await screen.findByRole('link', { name: 'Ada Lovelace' }));
    expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByRole('complementary', { name: 'Lead YOD-1' })).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  test('X selects cards and S applies the stage to every selected card', async () => {
    renderBoard([ada, grace]);
    await screen.findByTestId('board-card-YOD-2');
    await userEvent.keyboard('xjx');
    expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('board-card-YOD-2')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'read{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/leads/bulk',
      body: { change: { type: 'update', patch: { stageId: 'ready' } } },
    });
  });
});
