import { afterEach, describe, expect, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '@/components/command-palette.tsx';
import { queryKeys } from '@/lib/query/keys.ts';
import { restoreModulesAfterThisFile } from '../../tests-support.ts';
import { type Served, serveJson } from '../support/fetch.ts';
import { leadFixture } from '../support/lead-fixture.ts';
import { mockNavigation } from '../support/navigation.ts';
import { companyFixture, personFixture } from '../support/record-fixtures.ts';
import { renderWithClient } from '../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  navigation.push.mockClear();
});

const listQuery = encodeListQuery({ filter: emptyFilterGroup(), q: '' });

const searches = (sent: readonly Served[]) =>
  sent.filter((entry) => entry.url.startsWith('/api/search'));

async function settled(client: QueryClient, sent: readonly Served[]): Promise<void> {
  await waitFor(() => expect(searches(sent).length).toBeGreaterThan(0));
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

const emptyAnswer = () => ({ body: { people: [], companies: [], leads: [] } });

function renderPalette() {
  return renderWithClient(
    <CommandPalette open onOpenChange={() => undefined} onShowShortcuts={() => undefined} />,
  );
}

describe('CommandPalette record search', () => {
  test('a cached person shows without the server and a lead key jumps to the lead', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    client.setQueryData(queryKeys.leads('p1', listQuery), {
      pages: [
        {
          leads: [leadFixture({ personName: 'Ada Lovelace', personId: 'per1' })],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    const input = screen.getByPlaceholderText('Type a command or search');
    await userEvent.type(input, 'ada');
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, 'yod-12');
    const jump = await screen.findByText('Open YOD-12');
    expect(jump).toBeVisible();
    await userEvent.click(jump);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/l/YOD-12'));
    expect(searches(sent)).toEqual([]);
  });

  test('people and companies from the record caches show and open their pages', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    client.setQueryData(queryKeys.person('p-rec'), {
      person: personFixture({ id: 'p-rec', name: 'Katherine Johnson' }),
      employments: [],
      leads: [],
    });
    client.setQueryData(queryKeys.company('c-rec'), {
      company: companyFixture({ id: 'c-rec', name: 'Johnson Space', primaryDomain: 'space.io' }),
      people: [],
      leads: [],
    });
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'johnson');
    expect(await screen.findByText('Johnson Space')).toBeVisible();
    await settled(client, sent);
    await userEvent.click(await screen.findByText('Katherine Johnson'));
    expect(navigation.push).toHaveBeenCalledWith('/people/p-rec');
  });

  test('a company hit opens the company', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    client.setQueryData(queryKeys.companies(listQuery), {
      pages: [{ companies: [companyFixture({ id: 'c1', name: 'Zenith Labs' })], nextCursor: null }],
      pageParams: [null],
    });
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'zenith');
    await settled(client, sent);
    await userEvent.click(await screen.findByText('Zenith Labs'));
    expect(navigation.push).toHaveBeenCalledWith('/companies/c1');
  });

  test('a lead hit opens its person page on that lead', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    client.setQueryData(queryKeys.leads('p1', listQuery), {
      pages: [
        {
          leads: [
            leadFixture({ id: 'lx', key: 'YOD-5', personId: 'perx', personName: 'Quinn Doe' }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'yod-5');
    await settled(client, sent);
    await userEvent.click(await screen.findByText('YOD-5 Quinn Doe'));
    expect(navigation.push).toHaveBeenCalledWith('/people/perx?lead=lx');
  });

  test('an optimistic lead never routes to a pending person page', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    client.setQueryData(queryKeys.leads('p1', listQuery), {
      pages: [
        {
          leads: [
            leadFixture({
              id: 'lp',
              key: 'YOD-new',
              personId: 'pending-lp',
              personName: 'Pending Pat',
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'pending');
    await settled(client, sent);
    expect(screen.queryByText('YOD-new Pending Pat')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Pat')).not.toBeInTheDocument();
  });

  test('a server match the cache lacks is added and a fuzzy one is not hidden by the palette filter', async () => {
    const sent = serveJson(() => ({
      body: {
        people: [personFixture({ id: 'srv', name: 'Ghost Writer', primaryEmail: 'gw@pen.io' })],
        companies: [],
        leads: [],
      },
    }));
    const { client } = renderPalette();
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'gwr');
    expect(await screen.findByText('Ghost Writer')).toBeVisible();
    expect(screen.queryByText('Nothing matches that.')).not.toBeInTheDocument();
    expect(sent.some((entry) => entry.url === '/api/search?q=gwr')).toBe(true);
    await settled(client, sent);
  });

  test('a person in both the cache and the server answer is listed once', async () => {
    const sent = serveJson(() => ({
      body: {
        people: [personFixture({ id: 'per1', name: 'Ada Lovelace' })],
        companies: [],
        leads: [],
      },
    }));
    const { client } = renderPalette();
    client.setQueryData(queryKeys.person('per1'), {
      person: personFixture({ id: 'per1', name: 'Ada Lovelace' }),
      employments: [],
      leads: [],
    });
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'ada');
    await screen.findByText('Ada Lovelace');
    await waitFor(() => expect(searches(sent)).toHaveLength(1));
    await waitFor(() => expect(client.getQueryData(queryKeys.search('ada'))).toBeDefined());
    await settled(client, sent);
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1);
  });

  test('a term that matches nothing shows no records group and the empty message', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'zzzqqq');
    expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument();
    expect(screen.queryByText('Records')).not.toBeInTheDocument();
    await settled(client, sent);
  });

  test('commands still filter by the term', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'theme');
    expect(await screen.findByText('Toggle light and dark theme')).toBeInTheDocument();
    expect(screen.queryByText('Show keyboard shortcuts')).not.toBeInTheDocument();
    await settled(client, sent);
  });

  test('the search box and the server query stop at 200 characters', async () => {
    const sent = serveJson(emptyAnswer);
    const { client } = renderPalette();
    const input = screen.getByPlaceholderText('Type a command or search');
    expect(input).toHaveAttribute('maxlength', '200');
    fireEvent.change(input, { target: { value: 'q'.repeat(260) } });
    await waitFor(() => expect(searches(sent)).toHaveLength(1));
    const asked = new URL(searches(sent)[0]?.url ?? '', 'http://x').searchParams.get('q');
    expect(asked).toHaveLength(200);
    await settled(client, sent);
  });
});
