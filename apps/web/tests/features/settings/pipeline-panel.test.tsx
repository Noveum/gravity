import { afterEach, describe, expect, test } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/settings/pipelines/p1');
const { PipelinePanel } = await import('@/features/settings/pipeline-panel.tsx');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const AT = '2026-10-03T10:00:00.000Z';
const fixture = bootstrapFixture();
const [pipeline] = fixture.pipelines;
if (pipeline === undefined) throw new Error('The fixture has a pipeline.');
const stageOf = (name: string) => {
  const stage = fixture.stages.find((entry) => entry.name === name);
  if (stage === undefined) throw new Error(`The fixture has no ${name} stage.`);
  return stage;
};

const reorderBodySchema = z.object({ pipelineId: z.string(), stageIds: z.array(z.string()) });

function stageNames(): string[] {
  return within(screen.getByRole('list', { name: 'Stages' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-stage') ?? '');
}

function stageItem(name: string): HTMLElement {
  const item = within(screen.getByRole('list', { name: 'Stages' }))
    .getAllByRole('listitem')
    .find((entry) => entry.getAttribute('data-stage') === name);
  if (item === undefined) throw new Error(`No stage item for ${name}.`);
  return item;
}

describe('PipelinePanel', () => {
  test('moving a stage up reorders it at once and saves the order', async () => {
    const sent = serveJson((_url, _method, body) => ({ body: { stages: [], echo: body } }));
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Ready up' }));
    expect(stageNames().slice(0, 3)).toEqual(['New', 'Ready', 'Researching']);
    await waitFor(() => expect(sent).toHaveLength(1));
    const request = sent[0];
    if (request === undefined) throw new Error('No request was sent.');
    expect(request.url).toBe('/api/stages/reorder');
    const body = reorderBodySchema.parse(request.body);
    expect(body.pipelineId).toBe('p1');
    expect(body.stageIds.slice(0, 3)).toEqual(['new', 'ready', 'stage-researching']);
  });

  test('stage rows carry no repeated attribute labels', () => {
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    expect(
      within(screen.getByRole('list', { name: 'Stages' })).queryAllByText('stage New'),
    ).toHaveLength(0);
    expect(stageItem('New').querySelector('dt')).toBeNull();
    expect(stageItem('New')).toHaveClass('h-7');
  });

  test('the first stage cannot move up and the last cannot move down', () => {
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    expect(screen.getByRole('button', { name: 'Move New up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Do not contact down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move New down' })).toBeEnabled();
  });

  test('a refused archive puts the stage back and says why', async () => {
    serveJson(() => ({
      status: 409,
      body: {
        error: { code: 'conflict', message: 'Move the 3 leads in New out before archiving it.' },
      },
    }));
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive New' }));
    expect(
      await screen.findByText('Move the 3 leads in New out before archiving it.'),
    ).toBeInTheDocument();
    expect(stageNames()).toContain('New');
  });

  test('archiving a stage removes it from the list and sends the delete', async () => {
    const stage = stageOf('Follow-up');
    const sent = serveJson(() => ({ body: { stage: { ...stage, archivedAt: AT, syncId: 4 } } }));
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Follow-up' }));
    expect(stageNames()).not.toContain('Follow-up');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: `/api/stages/${stage.id}`, method: 'DELETE' });
  });

  test('renaming a stage saves the new name and retyping it saves the new type', async () => {
    const stage = stageOf('Ready');
    const sent = serveJson((_url, _method, body) => ({
      body: { stage: { ...stage, ...(body as object), syncId: 4 } },
    }));
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    const item = stageItem('Ready');
    await userEvent.click(within(item).getByRole('button', { name: 'Edit stage Ready' }));
    const input = within(item).getByRole('textbox', { name: 'stage Ready' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Qualified lead{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: `/api/stages/${stage.id}`,
      method: 'PATCH',
      body: { name: 'Qualified lead' },
    });
    expect(stageNames()).toContain('Qualified lead');
    await userEvent.selectOptions(
      within(stageItem('Qualified lead')).getByLabelText(/^Type of/),
      'won',
    );
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ method: 'PATCH', body: { category: 'won' } });
  });

  test('a new stage is added to the end of the list with the chosen type', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: {
        stage: {
          id: 'stage-nurture',
          pipelineId: 'p1',
          name: (body as { name: string }).name,
          category: (body as { category: string }).category,
          sortOrder: 99,
          syncId: 6,
          archivedAt: null,
        },
      },
    }));
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.type(screen.getByLabelText('New stage'), 'Nurture');
    await userEvent.selectOptions(screen.getByLabelText('New stage type'), 'hold');
    await userEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/stages',
      method: 'POST',
      body: { pipelineId: 'p1', name: 'Nurture', category: 'hold' },
    });
    await waitFor(() => expect(stageNames().at(-1)).toBe('Nurture'));
    expect(screen.getByLabelText('New stage')).toHaveValue('');
  });

  test('archiving the pipeline asks first, then goes back to the brands without a dead page', async () => {
    navigation.push.mockClear();
    const sent = serveJson(() => ({
      body: { pipeline: { ...pipeline, archivedAt: AT, syncId: 9 } },
    }));
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive pipeline' }));
    expect(sent).toHaveLength(0);
    const confirm = screen.getByRole('alertdialog', { name: 'Archive Prospecting' });
    expect(confirm).toHaveTextContent(
      'Its stages, pipeline fields and saved views leave every list, and this cannot be undone here.',
    );
    await userEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive pipeline' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Archive pipeline' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }),
    );
    expect(screen.queryByText('This pipeline does not exist')).not.toBeInTheDocument();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/settings/brands'));
    expect(screen.queryByText('This pipeline does not exist')).not.toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: '/api/pipelines/p1', method: 'DELETE' });
  });

  test('a refused pipeline archive stays on the page, restores it and says why', async () => {
    navigation.push.mockClear();
    serveJson((_url, method) =>
      method === 'GET'
        ? { body: bootstrapFixture() }
        : {
            status: 409,
            body: {
              error: {
                code: 'conflict',
                message: 'Close the 2 open or held leads in Prospecting before archiving it.',
              },
            },
          },
    );
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive pipeline' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }),
    );
    expect(
      await screen.findByText('Close the 2 open or held leads in Prospecting before archiving it.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Prospecting/ })).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  test('the key is shown read-only with the reason and cannot be edited', () => {
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    expect(screen.queryByRole('button', { name: 'Edit Key' })).not.toBeInTheDocument();
    expect(screen.getByText('YOD')).toBeInTheDocument();
    expect(screen.getByText('Keys are fixed: lead links use them.')).toBeInTheDocument();
  });

  test('a contributor sees the key too', () => {
    renderWithClient(<PipelinePanel pipelineId="p1" />, {
      bootstrap: bootstrapFixture({ me: { userId: 'u3', role: 'contributor' } }),
    });
    expect(screen.getByText('Keys are fixed: lead links use them.')).toBeInTheDocument();
  });

  test('archiving a stage raises an Undo toast that brings it back', async () => {
    const stage = stageOf('Follow-up');
    const sent = serveJson((url, method) => {
      if (url.pathname.endsWith('/unarchive')) return { body: { stage: { ...stage, syncId: 8 } } };
      if (method === 'DELETE') return { body: { stage: { ...stage, archivedAt: AT, syncId: 7 } } };
      return { body: bootstrapFixture() };
    });
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Follow-up' }));
    expect(stageNames()).not.toContain('Follow-up');
    expect(await screen.findByText('Archived Follow-up')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(stageNames()).toContain('Follow-up'));
    const restore = sent.find((request) => request.url.endsWith('/unarchive'));
    expect(restore).toMatchObject({ url: `/api/stages/${stage.id}/unarchive`, method: 'POST' });
    expect(stageNames().indexOf('Follow-up')).toBe(4);
  });

  test('an Undo the server refuses takes the stage away again and shows the message', async () => {
    const stage = stageOf('Follow-up');
    serveJson((url, method) => {
      if (url.pathname.endsWith('/unarchive')) {
        return {
          status: 404,
          body: { error: { code: 'not_found', message: 'That pipeline does not exist.' } },
        };
      }
      if (method === 'DELETE') return { body: { stage: { ...stage, archivedAt: AT, syncId: 7 } } };
      return {
        body: bootstrapFixture({
          stages: fixture.stages.filter((entry) => entry.id !== stage.id),
        }),
      };
    });
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Follow-up' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Could not restore Follow-up')).toBeInTheDocument();
    expect(screen.getByText('That pipeline does not exist.')).toBeInTheDocument();
    expect(stageNames()).not.toContain('Follow-up');
  });

  test('archiving a stage moves focus to the next row, else the previous, else the heading', async () => {
    serveJson((_url, method) =>
      method === 'DELETE'
        ? { body: { stage: { ...stageOf('Follow-up'), archivedAt: AT, syncId: 7 } } }
        : { body: bootstrapFixture() },
    );
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Follow-up' }));
    expect(
      within(stageItem('Replied')).getByRole('button', { name: 'Edit stage Replied' }),
    ).toHaveFocus();
  });

  test('archiving the last row focuses the previous one', async () => {
    serveJson((_url, method) =>
      method === 'DELETE'
        ? { body: { stage: { ...stageOf('Do not contact'), archivedAt: AT, syncId: 7 } } }
        : { body: bootstrapFixture() },
    );
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Do not contact' }));
    expect(
      within(stageItem('Closed: not a fit')).getByRole('button', {
        name: 'Edit stage Closed: not a fit',
      }),
    ).toHaveFocus();
  });

  test('archiving the only stage focuses the heading', async () => {
    const only = stageOf('New');
    serveJson((_url, method) =>
      method === 'DELETE'
        ? { body: { stage: { ...only, archivedAt: AT, syncId: 7 } } }
        : { body: bootstrapFixture() },
    );
    renderWithClient(<PipelinePanel pipelineId="p1" />, {
      bootstrap: bootstrapFixture({ stages: [only] }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Archive New' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  test('a refused new stage keeps its draft and shows the message with no toast', async () => {
    serveJson((_url, method) =>
      method === 'GET'
        ? { body: bootstrapFixture() }
        : { status: 422, body: { error: { code: 'invalid', message: 'Give it a name.' } } },
    );
    renderWithClient(<PipelinePanel pipelineId="p1" />);
    await userEvent.type(screen.getByLabelText('New stage'), 'Nurture');
    await userEvent.selectOptions(screen.getByLabelText('New stage type'), 'hold');
    await userEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give it a name.');
    expect(screen.getByLabelText('New stage')).toHaveValue('Nurture');
    expect(screen.getByLabelText('New stage type')).toHaveValue('hold');
    expect(screen.queryByText('Could not add Nurture')).not.toBeInTheDocument();
  });

  test('a pipeline that is not there says so and links back to the brands', () => {
    renderWithClient(<PipelinePanel pipelineId="missing" />);
    expect(screen.getByText('This pipeline does not exist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to brands' })).toHaveAttribute(
      'href',
      '/settings/brands',
    );
  });

  test('a contributor sees the stages with no way to change them', () => {
    renderWithClient(<PipelinePanel pipelineId="p1" />, {
      bootstrap: bootstrapFixture({ me: { userId: 'u3', role: 'contributor' } }),
    });
    expect(
      screen.getByText('Changing pipelines needs the member role. Ask an admin.'),
    ).toBeInTheDocument();
    expect(stageNames()).toContain('New');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New stage')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Type of New')).toBeDisabled();
  });
});
