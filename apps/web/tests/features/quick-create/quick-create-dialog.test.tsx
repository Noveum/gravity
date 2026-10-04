import { afterEach, describe, expect, mock, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useEffect, useState } from 'react';
import { useHotkeyRegistry } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { allCachedLeads, cachedLead } from '@/lib/query/lead-cache.ts';
import type { LeadPage } from '@/lib/query/schemas.ts';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { serveJson } from '../../support/fetch.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { personFixture } from '../../support/record-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');

const { QuickCreate } = await import('@/features/quick-create/quick-create-dialog.tsx');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  navigation.pathname = '/leads/YOD';
  navigation.push.mockClear();
});

const listKey = queryKeys.leads('p1', encodeListQuery({ filter: emptyFilterGroup(), q: '' }));

function renderQuickCreate(extra: ReactNode = null) {
  const result = renderWithClient(
    <>
      <QuickCreate />
      {extra}
    </>,
  );
  result.client.setQueryData(listKey, {
    pages: [
      {
        leads: [leadFixture({ personName: 'Ada Lovelace', personEmail: 'ada@acme.io' })],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
  return result;
}

function quickCreateServer(onQuick: (body: unknown) => { status?: number; body: unknown }) {
  return serveJson((url, _method, body) => {
    if (url.pathname === '/api/duplicates') return { body: { people: [], companies: [] } };
    return onQuick(body);
  });
}

function holdQuickCreate() {
  const sent: { url: string; body: unknown }[] = [];
  let release: (response: Response) => void = () => undefined;
  globalThis.fetch = mock((input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost:3300');
    sent.push({
      url: url.pathname,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (url.pathname !== '/api/leads/quick') {
      return Promise.resolve(Response.json({ people: [], companies: [] }));
    }
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  }) as unknown as typeof fetch;
  return {
    sent,
    fail: () =>
      release(
        Response.json(
          { error: { code: 'internal', message: 'held for the test' } },
          { status: 500 },
        ),
      ),
  };
}

function Suspender() {
  const registry = useHotkeyRegistry();
  useEffect(() => registry.suspend(), [registry]);
  return null;
}

function DragHold() {
  const [held, setHeld] = useState(true);
  return (
    <>
      {held ? <Suspender /> : null}
      <button type="button" onClick={() => setHeld(false)}>
        Drop
      </button>
    </>
  );
}

function leadIdOf(sent: readonly { url: string; body: unknown }[]): string {
  const request = sent.find((entry) => entry.url === '/api/leads/quick');
  const body = request?.body;
  if (typeof body === 'object' && body !== null && 'leadId' in body) return String(body.leadId);
  throw new Error('no quick create was sent');
}

describe('QuickCreate', () => {
  test('C opens it and a known email shows the existing person before the server answers', async () => {
    serveJson(() => ({ body: { people: [], companies: [] } }));
    renderQuickCreate();
    await userEvent.keyboard('c');
    await userEvent.type(await screen.findByLabelText('Person'), 'ada@acme.io');
    expect(screen.getByRole('button', { name: /Open Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Company domain')).toHaveValue('acme.io');
  });

  test('Cmd+Enter shows the row before any response and takes it back when the server refuses', async () => {
    const server = holdQuickCreate();
    const { client } = renderQuickCreate();
    await userEvent.keyboard('c');
    await userEvent.type(await screen.findByLabelText('Person'), 'grace@navy.mil');
    await userEvent.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    expect(
      allCachedLeads(client).some(
        (lead) => lead.personName === 'Grace Hopper' && lead.key === 'YOD-new',
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(server.sent.some((entry) => entry.url === '/api/leads/quick')).toBe(true),
    );
    const body = server.sent.find((entry) => entry.url === '/api/leads/quick')?.body as {
      person: unknown;
      pipelineId: string;
      leadId: string;
    };
    expect(body).toMatchObject({
      pipelineId: 'p1',
      person: { name: 'Grace Hopper', emails: ['grace@navy.mil'], company: { domain: 'navy.mil' } },
    });
    expect(cachedLead(client, body.leadId)).toMatchObject({ personName: 'Grace Hopper' });
    server.fail();
    await waitFor(() => expect(cachedLead(client, body.leadId)).toBeUndefined());
    expect(await screen.findByText('Could not add Grace Hopper')).toBeInTheDocument();
  });

  test('the server answer replaces the optimistic row instead of adding a second one', async () => {
    const sent = quickCreateServer((body) => {
      const leadId = (body as { leadId: string }).leadId;
      return {
        body: {
          lead: leadFixture({
            id: leadId,
            number: 7,
            key: 'YOD-7',
            personId: 'per-grace',
            personName: 'Grace Hopper',
            personEmail: 'grace@navy.mil',
            syncId: 40,
          }),
          person: personFixture({
            id: 'per-grace',
            name: 'Grace Hopper',
            emails: ['grace@navy.mil'],
            primaryEmail: 'grace@navy.mil',
            syncId: 39,
          }),
          company: null,
          personCreated: true,
        },
      };
    });
    const { client } = renderQuickCreate();
    await userEvent.keyboard('c');
    await userEvent.type(await screen.findByLabelText('Person'), 'grace@navy.mil');
    await userEvent.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(sent.some((entry) => entry.url === '/api/leads/quick')).toBe(true));
    const leadId = leadIdOf(sent);
    await waitFor(() =>
      expect(cachedLead(client, leadId)).toMatchObject({ key: 'YOD-7', syncId: 40 }),
    );
    const page = client.getQueryData<{ pages: LeadPage[] }>(listKey)?.pages[0];
    expect(page?.leads.filter((lead) => lead.id === leadId)).toHaveLength(1);
    expect(page?.leads).toHaveLength(2);
  });

  test('a bad entry stays in the dialog with its message and sends nothing', async () => {
    const sent = quickCreateServer(() => ({ body: {} }));
    renderQuickCreate();
    await userEvent.keyboard('c');
    await userEvent.type(await screen.findByLabelText('Person'), '   ');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add a name, an email or a LinkedIn URL.',
    );
    expect(sent.some((entry) => entry.url === '/api/leads/quick')).toBe(false);
  });

  test('the pipeline defaults to the one in the address and the owner to me', async () => {
    quickCreateServer(() => ({ body: {} }));
    renderQuickCreate();
    await userEvent.keyboard('c');
    expect(await screen.findByLabelText('Pipeline')).toHaveValue('p1');
    expect(screen.getByLabelText('Owner')).toHaveValue('u1');
  });

  test('Escape closes it, returns focus to where it was, and a reopened dialog starts empty', async () => {
    quickCreateServer(() => ({ body: {} }));
    renderQuickCreate(<button type="button">Row</button>);
    const row = screen.getByRole('button', { name: 'Row' });
    row.focus();
    await userEvent.keyboard('c');
    await userEvent.type(await screen.findByLabelText('Person'), 'half typed');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Person')).not.toBeInTheDocument());
    await waitFor(() => expect(row).toHaveFocus());
    await userEvent.keyboard('c');
    expect(await screen.findByLabelText('Person')).toHaveValue('');
  });

  test('C types a letter in a field instead of opening the dialog', async () => {
    renderQuickCreate(<input aria-label="Elsewhere" />);
    await userEvent.type(screen.getByLabelText('Elsewhere'), 'c');
    expect(screen.getByLabelText('Elsewhere')).toHaveValue('c');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
  });

  test('C opens it from a read-only field because nothing is typed there', async () => {
    quickCreateServer(() => ({ body: {} }));
    renderQuickCreate(<input aria-label="Frozen" readOnly />);
    screen.getByLabelText('Frozen').focus();
    await userEvent.keyboard('c');
    expect(await screen.findByLabelText('Person')).toBeInTheDocument();
  });

  test('C does nothing while a menu, picker or palette is open', async () => {
    renderQuickCreate(
      <div role="dialog" aria-label="Picker">
        <button type="button">Inside</button>
      </div>,
    );
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.keyboard('c');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await userEvent.keyboard('c');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
  });

  test('C does nothing while a drag holds the keyboard and works again after', async () => {
    quickCreateServer(() => ({ body: {} }));
    renderQuickCreate(<DragHold />);
    await userEvent.keyboard('c');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
    await userEvent.keyboard('c');
    expect(await screen.findByLabelText('Person')).toBeInTheDocument();
  });

  test('a second C while the dialog is open does not reset it', async () => {
    quickCreateServer(() => ({ body: {} }));
    renderQuickCreate();
    await userEvent.keyboard('c');
    await userEvent.type(await screen.findByLabelText('Person'), 'Ada');
    act(() => {
      fireEvent.keyDown(document.body, { key: 'c' });
    });
    expect(screen.getByLabelText('Person')).toHaveValue('Ada');
  });
});
