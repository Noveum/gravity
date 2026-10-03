import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
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
    return { body: { activities: [], nextCursor: null } };
  });
}

function renderRecord(focusLeadId: string | null = null) {
  return renderWithClient(
    <ContextPanelProvider>
      <PersonRecord personId="per1" focusLeadId={focusLeadId} />
    </ContextPanelProvider>,
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

  test('the card menu offers the record verbs', async () => {
    serve();
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for YOD-1' }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');
    expect(items.some((item) => item.startsWith('Set the priority'))).toBe(true);
    expect(items.some((item) => item.startsWith('Set the next action'))).toBe(false);
  });

  test('N focuses the note composer', async () => {
    serve();
    renderRecord();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.keyboard('n');
    expect(document.activeElement).toBe(screen.getByLabelText('Note'));
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
