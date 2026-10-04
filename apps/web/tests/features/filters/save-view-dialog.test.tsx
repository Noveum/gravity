import { afterEach, describe, expect, mock, test } from 'bun:test';
import { emptyFilterGroup, inCondition, replaceCondition } from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveViewDialog } from '@/features/filters/save-view-dialog.tsx';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Bootstrap } from '@/lib/query/schemas.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { renderWithClient } from '../../support/render.tsx';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const filter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready']));

describe('SaveViewDialog', () => {
  test('Cmd+S names and saves the current filter, shown at once', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      const view = {
        ...body,
        display: {},
        ownerId: 'u1',
        position: 0,
        syncId: 9,
        createdAt: '2026-10-03T10:00:00.000Z',
        updatedAt: '2026-10-03T10:00:00.000Z',
      };
      return Promise.resolve(respond({ view }));
    }) as unknown as typeof fetch;
    const onSaved = mock<(view: SavedViewRow) => void>();
    const { client } = renderWithClient(
      <SaveViewDialog
        object="lead"
        pipelineId="p1"
        filter={filter}
        viewId={null}
        onSaved={onSaved}
      />,
    );
    await userEvent.keyboard('{Meta>}s{/Meta}');
    const name = await screen.findByLabelText('View name');
    expect(name).toHaveFocus();
    await userEvent.type(name, 'Ready to send');
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone in the workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(
      client.getQueryData<Bootstrap>(queryKeys.bootstrap)?.savedViews.map((view) => view.name),
    ).toContain('Ready to send');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      object: 'lead',
      pipelineId: 'p1',
      name: 'Ready to send',
      visibility: 'workspace',
      filter,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ name: 'Ready to send', syncId: 9 });
  });

  test('Cmd+S does nothing for a guest, who cannot manage views', async () => {
    const fetched = mock(() => Promise.resolve(respond({})));
    globalThis.fetch = fetched as unknown as typeof fetch;
    renderWithClient(
      <SaveViewDialog object="lead" pipelineId="p1" filter={filter} viewId={null} />,
      { bootstrap: bootstrapFixture({ me: { userId: 'u3', role: 'guest' } }) },
    );
    await userEvent.keyboard('{Meta>}s{/Meta}');
    expect(screen.queryByRole('dialog') === null).toBe(true);
    expect(fetched).not.toHaveBeenCalled();
  });

  test('Cmd+S on a view you own updates it, and says Saved only once the server agrees', async () => {
    const owned: SavedViewRow = {
      id: 'v1',
      object: 'lead',
      pipelineId: 'p1',
      name: 'Hot leads',
      filter: emptyFilterGroup(),
      display: {},
      visibility: 'private',
      ownerId: 'u1',
      position: 0,
      syncId: 3,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    let answer: (response: Response) => void = () => undefined;
    const sent: { url: string; method: string | undefined; body: unknown }[] = [];
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      sent.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    }) as unknown as typeof fetch;
    const { client } = renderWithClient(
      <SaveViewDialog object="lead" pipelineId="p1" filter={filter} viewId="v1" />,
      {
        bootstrap: bootstrapFixture({ savedViews: [owned] }),
      },
    );
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: '/api/views/v1', method: 'PATCH', body: { filter } });
    expect(client.getQueryData<Bootstrap>(queryKeys.bootstrap)?.savedViews[0]?.filter).toEqual(
      filter,
    );
    expect(screen.queryByLabelText('View name')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved Hot leads')).not.toBeInTheDocument();
    answer(respond({ view: { ...owned, filter, syncId: 4 } }));
    expect(await screen.findByText('Saved Hot leads')).toBeInTheDocument();
  });

  test('a teammate view is saved as a new view of your own', async () => {
    const shared: SavedViewRow = {
      id: 'v2',
      object: 'lead',
      pipelineId: 'p1',
      name: 'Team list',
      filter: emptyFilterGroup(),
      display: {},
      visibility: 'workspace',
      ownerId: 'u2',
      position: 0,
      syncId: 3,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    renderWithClient(<SaveViewDialog object="lead" pipelineId="p1" filter={filter} viewId="v2" />, {
      bootstrap: bootstrapFixture({ savedViews: [shared] }),
    });
    await userEvent.keyboard('{Meta>}s{/Meta}');
    expect(await screen.findByLabelText('View name')).toBeInTheDocument();
  });

  test('Cmd+S on a view you own from another pipeline saves a new view for this one', async () => {
    const elsewhere: SavedViewRow = {
      id: 'v3',
      object: 'lead',
      pipelineId: 'p2',
      name: 'Other pipeline',
      filter: emptyFilterGroup(),
      display: {},
      visibility: 'private',
      ownerId: 'u1',
      position: 0,
      syncId: 3,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    const fetchMock = mock(() => Promise.resolve(respond({})));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWithClient(<SaveViewDialog object="lead" pipelineId="p1" filter={filter} viewId="v3" />, {
      bootstrap: bootstrapFixture({ savedViews: [elsewhere] }),
    });
    await userEvent.keyboard('{Meta>}s{/Meta}');
    expect(await screen.findByLabelText('View name')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
