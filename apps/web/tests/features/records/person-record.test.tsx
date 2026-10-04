import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SyncAction } from '@gravity/shared/events';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { employmentFixture, personFixture } from '../../support/record-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/people/per1');
stubLayoutSize(1400, 900);
afterAll(() => setViewport(false));

const { PersonRecord } = await import('@/features/records/person-record.tsx');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { setLeadTrail, setRecordTrail } = await import('@/lib/record-trail.ts');
const { CopyLinkProvider } = await import('@/lib/copy-link.tsx');
const { CRM_DELTA_HANDLERS } = await import('@/lib/realtime/crm-deltas.tsx');

const person = personFixture({
  location: 'London',
  timezone: 'Europe/London',
  companyId: 'c1',
  companyName: 'Acme',
  title: 'CTO',
});

const record = {
  person,
  employments: [employmentFixture({ title: 'CTO', syncId: 2 })],
  leads: [
    leadFixture({ id: 'l1', key: 'YOD-1' }),
    leadFixture({ id: 'l2', key: 'YOD-2', number: 2, stageId: 'ready', nextAction: 'Send deck' }),
  ],
};

const realFetch = globalThis.fetch;
beforeEach(() => {
  setViewport(true);
  navigation.push.mockClear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve() {
  return serveJson((url, method, body) => {
    if (url.pathname === '/api/people/per1' && method === 'PATCH') {
      return { body: { person: { ...person, ...(body as object), syncId: 6 } } };
    }
    if (url.pathname === '/api/people/per1') return { body: record };
    if (url.pathname === '/api/leads/l2' && method === 'PATCH') {
      return { body: { lead: leadFixture({ id: 'l2', key: 'YOD-2', number: 2, syncId: 20 }) } };
    }
    if (url.pathname === '/api/leads/l1' && method === 'PATCH') {
      return {
        body: {
          lead: leadFixture({ id: 'l1', key: 'YOD-1', nextAction: 'Call back', syncId: 21 }),
        },
      };
    }
    return { body: { activities: [], nextCursor: null } };
  });
}

function renderRecord(focusLeadId: string | null = null, bootstrap = bootstrapFixture()) {
  return renderWithClient(
    <ContextPanelProvider>
      <PersonRecord personId="per1" focusLeadId={focusLeadId} />
    </ContextPanelProvider>,
    { bootstrap },
  );
}

describe('PersonRecord', () => {
  test('shows the attributes and one card per lead', async () => {
    serve();
    renderRecord();
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('CTO at Acme')).toBeInTheDocument();
    const attributes = screen.getByTestId('record-attributes');
    expect(attributes.tagName).toBe('DL');
    expect(within(attributes).getByText('London')).toBeInTheDocument();
    expect(screen.getByTestId('lead-card-YOD-1')).toHaveTextContent('Yodu · Prospecting');
    expect(screen.getByTestId('lead-card-YOD-2')).toHaveTextContent('Next: Send deck');
  });

  test('Tab moves between the lead cards', async () => {
    serve();
    renderRecord();
    const first = await screen.findByTestId('lead-card-YOD-1');
    first.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByTestId('lead-card-YOD-2'));
    expect(screen.getByTestId('lead-card-YOD-2')).toHaveAttribute('aria-current', 'true');
  });

  test('5 shows facts, which arrive in a later milestone', async () => {
    const sent = serve();
    renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('5');
    expect(
      await screen.findByText('Facts arrive with research in the next milestone.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(sent.some((entry) => entry.url.includes('filter=facts'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: /Facts/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Timeline filter' }).tagName).toBe('FIELDSET');
  });

  test('a guest sees read-only fields, no lead menus and no note composer', async () => {
    const sent = serve();
    renderRecord(null, bootstrapFixture({ me: { userId: 'u3', role: 'guest' } }));
    const attributes = await screen.findByTestId('record-attributes');
    expect(within(attributes).getByText('London')).toBeInTheDocument();
    expect(within(attributes).queryByRole('button', { name: 'Edit Name' }) === null).toBe(true);
    expect(within(attributes).queryByRole('switch') === null).toBe(true);
    expect(screen.queryByRole('button', { name: 'More actions for YOD-1' }) === null).toBe(true);
    expect(screen.queryByLabelText('Note') === null).toBe(true);
    await userEvent.click(await screen.findByTestId('lead-card-YOD-1'));
    await userEvent.keyboard('s');
    expect(screen.queryByPlaceholderText('Move to stage') === null).toBe(true);
    expect(sent.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  test('editing the name updates at once and saves', async () => {
    const sent = serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Name' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Ada King{Enter}');
    expect(await screen.findByRole('heading', { name: 'Ada King' })).toBeInTheDocument();
    await waitFor(() =>
      expect(sent.find((entry) => entry.method === 'PATCH')?.body).toEqual({ name: 'Ada King' }),
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' }));
  });

  test('Escape abandons an edit without saving', async () => {
    const sent = serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Location' }));
    const input = screen.getByLabelText('Location');
    await userEvent.clear(input);
    await userEvent.type(input, 'Paris{Escape}');
    expect(screen.getByRole('button', { name: 'Edit Location' })).toHaveTextContent('London');
    expect(sent.some((entry) => entry.method === 'PATCH')).toBe(false);
  });

  test('the lead from the link is in focus and S moves it', async () => {
    const sent = serve();
    renderRecord('l2');
    expect(await screen.findByTestId('lead-card-YOD-2')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('s');
    await userEvent.type(await screen.findByPlaceholderText('Move to stage'), 'new{Enter}');
    await waitFor(() =>
      expect(sent.some((entry) => entry.url === '/api/leads/l2' && entry.method === 'PATCH')).toBe(
        true,
      ),
    );
  });

  test('the card menu sets the next action, with no key hint because N is the note', async () => {
    const sent = serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for YOD-1' }));
    const items = await screen.findAllByRole('menuitem');
    const nextAction = items.find((item) => item.textContent?.startsWith('Set the next action'));
    expect(nextAction?.textContent).toBe('Set the next action');
    expect(
      items.find((item) => item.textContent?.startsWith('Set the priority')),
    ).toHaveTextContent('P');
    if (nextAction === undefined) throw new Error('missing next action item');
    await userEvent.click(nextAction);
    await userEvent.type(await screen.findByPlaceholderText('Send the intro'), 'Call back{Enter}');
    await waitFor(() =>
      expect(sent.some((entry) => entry.url === '/api/leads/l1' && entry.method === 'PATCH')).toBe(
        true,
      ),
    );
  });

  test('N focuses the note composer', async () => {
    serve();
    renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('n');
    expect(document.activeElement).toBe(screen.getByLabelText('Note'));
  });

  test('keys keep working in the read-only composer and Escape returns to the lead card', async () => {
    serve();
    renderRecord('l2');
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('n');
    await userEvent.keyboard('6');
    expect(screen.getByRole('button', { name: /Changes/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByTestId('lead-card-YOD-2'));
  });

  test('saving on blur', async () => {
    const sent = serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Location' }));
    const input = screen.getByLabelText('Location');
    await userEvent.clear(input);
    await userEvent.type(input, 'Paris');
    await userEvent.tab();
    await waitFor(() =>
      expect(sent.find((entry) => entry.method === 'PATCH')?.body).toEqual({ location: 'Paris' }),
    );
  });

  test('an empty name is refused and nothing is sent', async () => {
    const sent = serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Name' }));
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Name' })).toHaveTextContent('Ada Lovelace');
    expect(sent.some((entry) => entry.method === 'PATCH')).toBe(false);
  });

  test('saved values are trimmed, and a value that trims to the stored one sends nothing', async () => {
    const sent = serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Location' }));
    await userEvent.clear(screen.getByLabelText('Location'));
    await userEvent.type(screen.getByLabelText('Location'), '  London  {Enter}');
    expect(sent.some((entry) => entry.method === 'PATCH')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), ' Ada King  {Enter}');
    await waitFor(() =>
      expect(sent.find((entry) => entry.method === 'PATCH')?.body).toEqual({ name: 'Ada King' }),
    );
  });

  test('an invalid number keeps the stored value and says why', async () => {
    const seats: FieldDefinitionRow = {
      id: 'f1',
      object: 'person',
      pipelineId: null,
      key: 'seats',
      label: 'Seats',
      type: 'number',
      options: [],
      description: '',
      example: '',
      position: 0,
      syncId: 1,
      archivedAt: null,
    };
    const sent = serveJson((url) =>
      url.pathname === '/api/people/per1'
        ? { body: { ...record, person: { ...person, fields: { seats: 12 } } } }
        : { body: { activities: [], nextCursor: null } },
    );
    renderWithClient(
      <ContextPanelProvider>
        <PersonRecord personId="per1" focusLeadId={null} />
      </ContextPanelProvider>,
      { bootstrap: bootstrapFixture({ fields: [seats] }) },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Seats' }));
    const input = screen.getByLabelText('Seats');
    await userEvent.clear(input);
    await userEvent.type(input, 'twelve{Enter}');
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();
    expect(screen.getByLabelText('Seats')).toHaveAttribute('aria-invalid', 'true');
    expect(sent.some((entry) => entry.method === 'PATCH')).toBe(false);
    for (const entry of ['0x10', '1e3']) {
      await userEvent.clear(input);
      await userEvent.type(input, `${entry}{Enter}`);
      expect(screen.getByText('Enter a number.')).toBeInTheDocument();
    }
    expect(sent.some((entry) => entry.method === 'PATCH')).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Edit Seats' })).toHaveTextContent('12');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Seats' }));
    await userEvent.clear(screen.getByLabelText('Seats'));
    await userEvent.type(screen.getByLabelText('Seats'), '12.0{Enter}');
    expect(screen.getByRole('button', { name: 'Edit Seats' })).toHaveTextContent('12');
    expect(sent.some((entry) => entry.method === 'PATCH')).toBe(false);
  });

  test('a window refocus does not move the lead in focus on a deep-linked record', async () => {
    serve();
    renderRecord();
    const second = await screen.findByTestId('lead-card-YOD-2');
    fireEvent.blur(window);
    fireEvent.focusIn(second, { relatedTarget: null });
    expect(screen.getByTestId('lead-card-YOD-1')).toHaveAttribute('aria-current', 'true');
  });

  test('copy link names the lead actually in focus, not a stale one from the URL', async () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    serve();
    renderWithClient(
      <ContextPanelProvider>
        <CopyLinkProvider>
          <PersonRecord personId="per1" focusLeadId="gone" />
        </CopyLinkProvider>
      </ContextPanelProvider>,
    );
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost:3300/people/per1?lead=l1'),
    );
  });

  test('a person delta relabels the open record', async () => {
    serve();
    const { client } = renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    const handler = CRM_DELTA_HANDLERS.find(([model]) => model === 'person')?.[1];
    const delta: SyncAction = {
      syncId: 9,
      organizationId: 'o1',
      scopes: ['workspace:o1'],
      action: 'update',
      model: 'person',
      modelId: 'per1',
      data: { ...person, name: 'Ada Byron', syncId: 9 },
      actor: { type: 'user', id: 'u2' },
      at: new Date(0).toISOString(),
    };
    act(() => {
      handler?.(delta, client);
    });
    expect(await screen.findByRole('heading', { name: 'Ada Byron' })).toBeInTheDocument();
  });

  test('an optimistic edit holds while the server is slow to answer', async () => {
    let answer: (response: Response) => void = () => undefined;
    globalThis.fetch = mock((input: string, init: RequestInit = {}) => {
      const path = new URL(input, 'http://localhost:3300').pathname;
      if (path === '/api/people/per1' && init.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      }
      const body = path === '/api/people/per1' ? record : { activities: [], nextCursor: null };
      return Promise.resolve(Response.json(body));
    }) as unknown as typeof fetch;
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Name' }));
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Ada King{Enter}');
    expect(await screen.findByRole('heading', { name: 'Ada King' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('heading', { name: 'Ada King' })).toBeInTheDocument();
    await act(async () => {
      answer(Response.json({ person: { ...person, name: 'Ada King', syncId: 6 } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('heading', { name: 'Ada King' })).toBeInTheDocument();
  });

  test('[ and ] work while the record is still failing to load', async () => {
    serveJson(() => ({
      status: 500,
      body: { error: { code: 'internal', message: 'The database is down.' } },
    }));
    setRecordTrail('/people', ['per0', 'per1', 'per2']);
    renderRecord();
    await screen.findByText('Could not load this person');
    await userEvent.keyboard(']');
    expect(navigation.push).toHaveBeenCalledWith('/people/per2');
  });

  test('[ and ] step through the list the record was opened from', async () => {
    serve();
    setLeadTrail([
      { personId: 'per0', id: 'l0' },
      { personId: 'per1', id: 'l1' },
      { personId: 'per2', id: 'l9' },
    ]);
    renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard(']');
    expect(navigation.push).toHaveBeenCalledWith('/people/per2?lead=l9');
    await userEvent.keyboard('[[');
    expect(navigation.push).toHaveBeenCalledWith('/people/per0?lead=l0');
  });

  test('[ and ] do nothing at the ends of the list', async () => {
    serve();
    setRecordTrail('/people', ['per1']);
    renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('[[]');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  test('Cmd+Shift+A asks for the context of the lead actually in focus', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const sent = serveJson((url) => {
      if (url.pathname === '/api/context') {
        return { body: { subject: { type: 'lead', id: 'l2' }, text: 'Lead YOD-2' } };
      }
      if (url.pathname === '/api/people/per1') return { body: record };
      return { body: { activities: [], nextCursor: null } };
    });
    renderRecord('l2');
    expect(await screen.findByTestId('lead-card-YOD-2')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Lead YOD-2'));
    expect(sent.find((entry) => entry.url.startsWith('/api/context'))?.url).toBe(
      '/api/context?ref=l2',
    );
  });

  test('Cmd+Shift+A falls back to the person when the lead from the link is gone', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const sent = serveJson((url) => {
      if (url.pathname === '/api/context') {
        return { body: { subject: { type: 'person', id: 'per1' }, text: 'Person Ada' } };
      }
      if (url.pathname === '/api/people/per1') return { body: { ...record, leads: [] } };
      return { body: { activities: [], nextCursor: null } };
    });
    renderRecord('gone');
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person Ada'));
    expect(sent.find((entry) => entry.url.startsWith('/api/context'))?.url).toBe(
      '/api/context?ref=per1',
    );
  });

  test('Cmd+Shift+A still works from the read-only note composer', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    serveJson((url) => {
      if (url.pathname === '/api/context') {
        return { body: { subject: { type: 'lead', id: 'l1' }, text: 'Lead YOD-1' } };
      }
      if (url.pathname === '/api/people/per1') return { body: record };
      return { body: { activities: [], nextCursor: null } };
    });
    renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('n');
    expect(document.activeElement).toBe(screen.getByLabelText('Note'));
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Lead YOD-1'));
  });

  test('a person that cannot be loaded says so', async () => {
    serveJson(() => ({
      status: 404,
      body: { error: { code: 'not_found', message: 'That person does not exist.' } },
    }));
    renderRecord();
    expect(await screen.findByText('Could not load this person')).toBeInTheDocument();
    expect(screen.getByText('That person does not exist.')).toBeInTheDocument();
  });
});
