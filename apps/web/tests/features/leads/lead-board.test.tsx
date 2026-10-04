import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import type { LeadRow, PipelineRow } from '@gravity/shared/records';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
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
const { useLeadList } = await import('@/lib/query/use-leads.ts');
const { placeLead } = await import('@/lib/query/lead-cache.ts');
const { queryKeys } = await import('@/lib/query/keys.ts');

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

function renderBoard(leads: readonly LeadRow[] = [leadFixture()], shown = bootstrap) {
  return renderWithClient(
    <ContextPanelProvider>
      <LeadUndoHotkeys workspaceId="o1" />
      <LeadBoard pipeline={pipeline} stages={bootstrap.stages} leads={leads} />
    </ContextPanelProvider>,
    { bootstrap: shown },
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

  test('a guest cannot move cards: Shift+arrows and M do nothing and cards are not draggable', async () => {
    renderBoard([leadFixture()], bootstrapFixture({ me: { userId: 'u3', role: 'guest' } }));
    const card = await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    act(() => card.focus());
    await userEvent.keyboard('m');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: 'More actions for YOD-1' })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  test('Shift+Left moves the focused card one stage back', async () => {
    renderBoard([alan]);
    await screen.findByTestId('board-card-YOD-3');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ type: 'update', patch: { stageId: 'stage-researching' } });
  });

  test('Shift+Left on a card in the first stage sends nothing', async () => {
    renderBoard();
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sent).toHaveLength(0);
  });

  test('Shift+Right never closes a lead: it skips the won stage and asks for a hold reason', async () => {
    renderBoard([leadFixture({ stageId: 'stage-meeting-held' })]);
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(await screen.findByLabelText('Reason')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  test('Shift+Right stops at the last hold stage', async () => {
    renderBoard([leadFixture({ stageId: 'stage-on-hold', stageCategory: 'hold' })]);
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sent).toHaveLength(0);
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  });

  test('a lead in the Other group moves forward into the first open stage, never back', async () => {
    renderBoard([leadFixture({ stageId: 'stage-gone', stageCategory: 'open' })]);
    expect(await screen.findByTestId('board-column-Other')).toContainElement(
      screen.getByTestId('board-card-YOD-1'),
    );
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sent).toHaveLength(0);
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ type: 'update', patch: { stageId: 'new' } });
  });

  test('moving into the hold stage asks for a reason first, then holds without a toast', async () => {
    renderBoard([leadFixture({ stageId: 'stage-qualified', stageCategory: 'won' })]);
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    const reason = await screen.findByLabelText('Reason');
    expect(sent).toHaveLength(0);
    await userEvent.type(reason, 'Back in spring{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ type: 'hold', reason: 'Back in spring' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  test('a single card move raises no toast, like the list', async () => {
    renderBoard();
    await screen.findByTestId('board-card-YOD-1');
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
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
    await userEvent.tab();
    await userEvent.tab();
    const card = screen.getByTestId('board-card-YOD-1');
    expect(card).toHaveFocus();
    expect(card).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard(' ');
    expect(await screen.findByRole('complementary', { name: 'Lead YOD-1' })).toBeInTheDocument();
    expect(screen.queryByText(/was dropped|Picked up/)).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(navigation.push).toHaveBeenCalledWith('/people/per1?lead=l1');
  });

  test('each card is one tab stop with nothing focusable inside it', async () => {
    renderBoard([ada, grace]);
    const card = await screen.findByTestId('board-card-YOD-2');
    expect(card).toHaveAttribute('tabindex', '0');
    expect(card.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
    await userEvent.tab();
    expect(card).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByTestId('board-card-YOD-1')).toHaveFocus();
  });

  test('a plain click on a card focuses and peeks it', async () => {
    renderWithClient(
      <ContextPanelProvider>
        <LeadBoard pipeline={pipeline} stages={bootstrap.stages} leads={[ada, grace]} />
        <ContextPanel />
      </ContextPanelProvider>,
      { bootstrap },
    );
    await userEvent.click(await screen.findByText('Ada Lovelace'));
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

describe('LeadBoard over the live list cache', () => {
  const emptyQuery = { filter: emptyFilterGroup(), q: '' };

  function LiveBoard() {
    const list = useLeadList('p1', emptyQuery);
    return <LeadBoard pipeline={pipeline} stages={bootstrap.stages} leads={list.leads} />;
  }

  function renderLive(leads: readonly LeadRow[]) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(queryKeys.leads('p1', encodeListQuery(emptyQuery)), {
      pages: [{ leads, nextCursor: null }],
      pageParams: [null],
    });
    return renderWithClient(
      <ContextPanelProvider>
        <LeadUndoHotkeys workspaceId="o1" />
        <LiveBoard />
      </ContextPanelProvider>,
      { bootstrap, client },
    );
  }

  test('a card that had the focus keeps it after Shift+Right moves it', async () => {
    renderLive([ada]);
    const card = await screen.findByTestId('board-card-YOD-1');
    act(() => card.focus());
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() =>
      expect(screen.getByTestId('board-column-Researching')).toContainElement(
        screen.getByTestId('board-card-YOD-1'),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('board-card-YOD-1')).toHaveFocus());
  });

  test('a card that had the focus keeps it when a teammate moves it', async () => {
    const { client } = renderLive([ada, grace]);
    const card = await screen.findByTestId('board-card-YOD-1');
    act(() => card.focus());
    act(() => placeLead(client, { ...ada, stageId: 'stage-contacted', syncId: 70 }));
    await waitFor(() =>
      expect(screen.getByTestId('board-column-Contacted')).toContainElement(
        screen.getByTestId('board-card-YOD-1'),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('board-card-YOD-1')).toHaveFocus());
  });

  test('a focus that left the board is not pulled back by a move', async () => {
    const { client } = renderLive([ada]);
    const card = await screen.findByTestId('board-card-YOD-1');
    act(() => card.focus());
    act(() => card.blur());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => placeLead(client, { ...ada, stageId: 'stage-contacted', syncId: 71 }));
    await waitFor(() =>
      expect(screen.getByTestId('board-column-Contacted')).toContainElement(
        screen.getByTestId('board-card-YOD-1'),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId('board-card-YOD-1')).not.toHaveFocus();
  });

  describe('keyboard drag', () => {
    const COLUMN_WIDTH = 288;
    const COLUMN_STEP = 300;
    let original: PropertyDescriptor | undefined;

    function rect(left: number, top: number, width: number, height: number): DOMRect {
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      };
    }

    function layoutOf(element: Element): DOMRect {
      const columns = [...document.querySelectorAll('[data-testid^="board-column-"]')];
      const column = element.closest('[data-testid^="board-column-"]');
      const index = column === null ? -1 : columns.indexOf(column);
      if (index === -1) {
        const lifted = document.querySelector('[data-lifted="true"]');
        return lifted === null ? rect(0, 0, 0, 0) : layoutOf(lifted);
      }
      const left = 12 + index * COLUMN_STEP;
      if (element === column) return rect(left, 50, COLUMN_WIDTH, 700);
      if (element.hasAttribute('data-lead-id')) return rect(left + 8, 100, COLUMN_WIDTH - 16, 56);
      return rect(left, 50, COLUMN_WIDTH, 700);
    }

    beforeAll(() => {
      original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: Element) {
          return layoutOf(this);
        },
      });
    });
    afterAll(() => {
      if (original === undefined)
        Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
      else Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', original);
    });

    async function pause() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    async function pickUp(key: string) {
      const card = await screen.findByTestId(`board-card-${key}`);
      act(() => card.focus());
      await userEvent.keyboard('m');
      await pause();
    }

    test('M picks the card up, the arrows choose a stage, and Enter drops it there', async () => {
      renderLive([ada]);
      await pickUp('YOD-1');
      await userEvent.keyboard('{ArrowRight}');
      await pause();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toEqual({
        url: '/api/leads/l1',
        body: { type: 'update', patch: { stageId: 'stage-researching' } },
      });
      expect(navigation.push).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByTestId('board-column-Researching')).toContainElement(
          screen.getByTestId('board-card-YOD-1'),
        ),
      );
      await waitFor(() => expect(screen.getByTestId('board-card-YOD-1')).toHaveFocus());
      await userEvent.keyboard('{Meta>}z{/Meta}');
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[1]?.body).toEqual({ type: 'update', patch: { stageId: 'new' } });
    });

    test('while a card is lifted no other key runs: J, V, S and Space do nothing', async () => {
      renderLive([ada, grace]);
      await pickUp('YOD-2');
      await userEvent.keyboard('jsv');
      expect(screen.queryByPlaceholderText('Move to stage')).not.toBeInTheDocument();
      expect(screen.getByTestId('board-card-YOD-2')).toHaveAttribute('data-active', 'true');
      await userEvent.keyboard('{Escape}');
      await pause();
      await userEvent.keyboard('j');
      expect(screen.getByTestId('board-card-YOD-1')).toHaveAttribute('data-active', 'true');
      expect(sent).toHaveLength(0);
    });

    test('dropping on the hold column asks for a reason before anything is sent', async () => {
      renderLive([ada]);
      await pickUp('YOD-1');
      for (let step = 0; step < 9; step += 1) {
        await userEvent.keyboard('{ArrowRight}');
        await pause();
      }
      await userEvent.keyboard(' ');
      expect(await screen.findByLabelText('Reason')).toBeInTheDocument();
      expect(sent).toHaveLength(0);
    });

    test('dropping on a won column is an explicit close', async () => {
      renderLive([ada]);
      await pickUp('YOD-1');
      for (let step = 0; step < 8; step += 1) {
        await userEvent.keyboard('{ArrowRight}');
        await pause();
      }
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]?.body).toEqual({ type: 'close', stageId: 'stage-qualified' });
    });
  });
});
