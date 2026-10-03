import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LeadRow, StageRow } from '@gravity/shared/records';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
mockNavigation('/leads/YOD');
stubLayoutSize(1200, 800);
afterAll(() => setViewport(false));

const { LeadList } = await import('@/features/leads/lead-list.tsx');
const { LeadVerbs } = await import('@/features/leads/lead-verbs.tsx');
const { LeadUndoHotkeys, clearLeadHistory } = await import('@/features/leads/lead-undo.ts');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { queryKeys } = await import('@/lib/query/keys.ts');

const bootstrap = bootstrapFixture();
const pipeline = bootstrap.pipelines[0];
if (pipeline === undefined) throw new Error('fixture pipeline');
const leads: LeadRow[] = [
  leadFixture({ id: 'l1', key: 'YOD-1', number: 1, personId: 'per1' }),
  leadFixture({ id: 'l2', key: 'YOD-2', number: 2, personId: 'per2', personName: 'Grace Hopper' }),
];

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const sent: Sent[] = [];
const held: (() => void)[] = [];
let holding = false;
const realFetch = globalThis.fetch;

function patchedRow(id: string, change: Record<string, unknown>): LeadRow {
  const base = leads.find((lead) => lead.id === id) ?? leadFixture();
  const patch = (change['patch'] ?? {}) as Partial<LeadRow>;
  return { ...base, ...patch, syncId: base.syncId + 10 + sent.length };
}

function respond(url: string, body: Record<string, unknown>): Response {
  const payload = url.endsWith('/bulk')
    ? {
        leads: (body['leadIds'] as string[]).map((id) =>
          patchedRow(id, body['change'] as Record<string, unknown>),
        ),
      }
    : { lead: patchedRow(url.split('/').at(-1) ?? '', body) };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  sent.length = 0;
  held.length = 0;
  holding = false;
  clearLeadHistory();
  setViewport(true);
  globalThis.fetch = mock((url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    sent.push({ url, method: init.method ?? 'GET', body });
    const response = respond(url, body);
    if (!holding) return Promise.resolve(response);
    return new Promise<Response>((resolve) => {
      held.push(() => resolve(response));
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface HarnessProps {
  readonly rows: readonly LeadRow[];
  readonly stages: readonly StageRow[];
  readonly workspaceId?: string;
}

function Harness({ rows, stages, workspaceId = 'o1' }: HarnessProps) {
  return (
    <ContextPanelProvider>
      <LeadUndoHotkeys workspaceId={workspaceId} />
      {pipeline === undefined ? null : (
        <LeadList
          pipeline={pipeline}
          stages={stages}
          leads={rows}
          renderActions={(selection) => (
            <LeadVerbs selection={selection} pipelineId={pipeline.id} />
          )}
        />
      )}
    </ContextPanelProvider>
  );
}

function renderWithVerbs(options: { readonly bootstrap?: typeof bootstrap } = {}) {
  const shown = options.bootstrap ?? bootstrap;
  return renderWithClient(<Harness rows={leads} stages={shown.stages} />, { bootstrap: shown });
}

describe('LeadVerbs', () => {
  test('S opens a stage picker on the focused row; typing filters and Enter moves the lead', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('s');
    const input = await screen.findByPlaceholderText('Move to stage');
    await userEvent.type(input, 'read');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/leads/l2',
      method: 'PATCH',
      body: { type: 'update', patch: { stageId: 'ready' } },
    });
  });

  test('a bulk priority change goes through the bulk route and Undo restores it', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('x');
    await userEvent.keyboard('{Shift>}j{/Shift}');
    await userEvent.keyboard('p');
    await userEvent.type(await screen.findByPlaceholderText('Set priority'), 'urg');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/leads/bulk',
      body: { leadIds: ['l2', 'l1'], change: { type: 'update', patch: { priority: 1 } } },
    });
    expect(await screen.findByText('Set priority to Urgent on 2 leads')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.body).toMatchObject({ change: { type: 'update', patch: { priority: 0 } } });
  });

  test('Shift+H needs a reason before it holds the lead', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('{Shift>}h{/Shift}');
    const reason = await screen.findByLabelText('Reason');
    await userEvent.keyboard('{Enter}');
    expect(sent).toHaveLength(0);
    await userEvent.type(reason, 'Back in Q1{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ type: 'hold', reason: 'Back in Q1', until: null });
  });

  test('the picker anchors to the focused row and hands focus back to it on close', async () => {
    renderWithVerbs();
    const row = await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('s');
    await screen.findByPlaceholderText('Move to stage');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Move to stage')).not.toBeInTheDocument(),
    );
    expect(row.contains(document.activeElement)).toBe(true);
    expect(row).toHaveAttribute('data-active', 'true');
    expect(sent).toHaveLength(0);
  });

  test('Cmd+Z undoes a single-lead change and Cmd+Shift+Z redoes it', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'read{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Move to stage')).not.toBeInTheDocument(),
    );
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({
      url: '/api/leads/l2',
      body: { type: 'update', patch: { stageId: 'new' } },
    });
    expect(await screen.findByText('Undid: Moved YOD-2 to Ready')).toBeInTheDocument();
    await userEvent.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]?.body).toEqual({ type: 'update', patch: { stageId: 'ready' } });
  });

  test('after the toast Undo, Cmd+Z cannot undo the same change a second time', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('x{Shift>}j{/Shift}a');
    await userEvent.type(await screen.findByPlaceholderText('Assign to'), 'tess{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ change: { type: 'update', patch: { ownerId: 'u2' } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(sent).toHaveLength(2);
  });

  test('rapid verbs each keep their undo entry, undone newest first', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    holding = true;
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'read{Enter}');
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Move to stage')).not.toBeInTheDocument(),
    );
    await userEvent.keyboard('p');
    await userEvent.type(await screen.findByPlaceholderText('Set priority'), 'high{Enter}');
    await waitFor(() => expect(held).toHaveLength(2));
    holding = false;
    await act(async () => {
      held[1]?.();
      held[0]?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]?.body).toEqual({ type: 'update', patch: { priority: 0 } });
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(sent).toHaveLength(4));
    expect(sent[3]?.body).toEqual({ type: 'update', patch: { stageId: 'new' } });
  });

  test('a teammate change after ours is never overwritten by Cmd+Z', async () => {
    const { client } = renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'read{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    const ours = patchedRow('l2', { patch: { stageId: 'ready' } });
    client.setQueryData(queryKeys.lead('l2'), {
      ...ours,
      stageId: 'stage-contacted',
      ownerId: 'u2',
      syncId: 99,
    });
    await userEvent.keyboard('{Meta>}z{/Meta}');
    expect(
      await screen.findByText('Nothing to undo: a teammate has changed YOD-2 since'),
    ).toBeInTheDocument();
    expect(sent).toHaveLength(1);
  });

  test('N sets the next action and the chosen date', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('n');
    const text = await screen.findByRole('textbox', { name: 'Next action' });
    await userEvent.type(text, 'Send the deck');
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    expect(text).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    const patch = (sent[0]?.body['patch'] ?? {}) as Record<string, unknown>;
    expect(patch['nextAction']).toBe('Send the deck');
    expect(new Date(String(patch['nextActionAt'])).getHours()).toBe(9);
  });

  test('Enter on a focused date choice submits the hold with that choice', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('{Shift>}h{/Shift}');
    await userEvent.type(await screen.findByLabelText('Reason'), 'Budget freeze');
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'One week' })).toHaveFocus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ type: 'hold', reason: 'Budget freeze' });
    expect(new Date(String(sent[0]?.body['until'])).getHours()).toBe(9);
  });

  test('Cmd+Backspace closes the lead into the chosen won or lost stage', async () => {
    renderWithVerbs();
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('{Meta>}{Backspace}{/Meta}');
    const input = await screen.findByPlaceholderText('Close as');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).queryByText('Ready')).not.toBeInTheDocument();
    await userEvent.type(input, 'not a fit{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ type: 'close', stageId: 'stage-closed-not-a-fit' });
  });

  test('pickers list live stages only', async () => {
    const archived = bootstrapFixture({
      stages: bootstrap.stages.map((stage) =>
        stage.name === 'Researching' ? { ...stage, archivedAt: '2026-10-02T10:00:00.000Z' } : stage,
      ),
    });
    renderWithVerbs({ bootstrap: archived });
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('s');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('Ready')).toBeInTheDocument();
    expect(within(listbox).queryByText('Researching')).not.toBeInTheDocument();
  });
});

function SelectionLeaves() {
  const [rows, setRows] = useState<readonly LeadRow[]>(leads);
  return (
    <>
      <Harness rows={rows} stages={bootstrap.stages} />
      <button type="button" onClick={() => setRows(leads.filter((lead) => lead.id !== 'l2'))}>
        Teammate moves YOD-2 away
      </button>
    </>
  );
}

describe('when the selection leaves the list', () => {
  test('the bar and the toast name the focused lead the verb falls back to', async () => {
    renderWithClient(<SelectionLeaves />, { bootstrap });
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('x');
    await userEvent.click(screen.getByRole('button', { name: 'Teammate moves YOD-2 away' }));
    const bar = await screen.findByRole('status', { name: 'Selection' });
    expect(bar).toHaveTextContent('Your selection left the list. Verbs act on YOD-1 Ada Lovelace.');
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'read{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toBe('/api/leads/l1');
    expect(await screen.findByText('Moved YOD-1 to Ready')).toBeInTheDocument();
  });
});

function WorkspaceSwitch() {
  const [workspaceId, setWorkspaceId] = useState('o1');
  return (
    <>
      <Harness rows={leads} stages={bootstrap.stages} workspaceId={workspaceId} />
      <button type="button" onClick={() => setWorkspaceId('o2')}>
        Switch workspace
      </button>
    </>
  );
}

describe('LeadUndoHotkeys', () => {
  test('switching workspace clears the undo history', async () => {
    renderWithClient(<WorkspaceSwitch />, { bootstrap });
    await screen.findByTestId('lead-row-YOD-2');
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'read{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(sent).toHaveLength(1);
  });
});
