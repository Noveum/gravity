import { afterEach, describe, expect, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '@/components/command-palette.tsx';
import { queryKeys } from '@/lib/query/keys.ts';
import { restoreModulesAfterThisFile } from '../../tests-support.ts';
import { serveJson } from '../support/fetch.ts';
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

function renderPalette() {
  return renderWithClient(
    <CommandPalette open onOpenChange={() => undefined} onShowShortcuts={() => undefined} />,
  );
}

describe('CommandPalette record search', () => {
  test('a cached person shows without the server and a lead key jumps to the lead', async () => {
    serveJson(() => ({ body: { people: [], companies: [], leads: [] } }));
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
  });

  test('people and companies from the record caches show and open their pages', async () => {
    serveJson(() => ({ body: { people: [], companies: [], leads: [] } }));
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
    await userEvent.click(await screen.findByText('Katherine Johnson'));
    expect(navigation.push).toHaveBeenCalledWith('/people/p-rec');
  });

  test('a company hit opens the company and a lead hit opens its person with the lead', async () => {
    serveJson(() => ({ body: { people: [], companies: [], leads: [] } }));
    const { client } = renderPalette();
    client.setQueryData(queryKeys.companies(listQuery), {
      pages: [{ companies: [companyFixture({ id: 'c1', name: 'Zenith Labs' })], nextCursor: null }],
      pageParams: [null],
    });
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'zenith');
    await userEvent.click(await screen.findByText('Zenith Labs'));
    expect(navigation.push).toHaveBeenCalledWith('/companies/c1');
  });

  test('a lead hit opens its person page on that lead', async () => {
    serveJson(() => ({ body: { people: [], companies: [], leads: [] } }));
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
    await userEvent.click(await screen.findByText('YOD-5 Quinn Doe'));
    expect(navigation.push).toHaveBeenCalledWith('/people/perx?lead=lx');
  });

  test('a server match the cache lacks is added and a fuzzy one is not hidden by the palette filter', async () => {
    const sent = serveJson(() => ({
      body: {
        people: [personFixture({ id: 'srv', name: 'Ghost Writer', primaryEmail: 'gw@pen.io' })],
        companies: [],
        leads: [],
      },
    }));
    renderPalette();
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'gwr');
    expect(await screen.findByText('Ghost Writer')).toBeVisible();
    expect(screen.queryByText('Nothing matches that.')).not.toBeInTheDocument();
    expect(sent.some((entry) => entry.url === '/api/search?q=gwr')).toBe(true);
  });

  test('a person in both the cache and the server answer is listed once', async () => {
    serveJson(() => ({
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1);
  });

  test('a term that matches nothing shows no records group and the empty message', async () => {
    serveJson(() => ({ body: { people: [], companies: [], leads: [] } }));
    renderPalette();
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'zzzqqq');
    expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument();
    expect(screen.queryByText('Records')).not.toBeInTheDocument();
  });

  test('commands still filter by the term', async () => {
    serveJson(() => ({ body: { people: [], companies: [], leads: [] } }));
    renderPalette();
    await userEvent.type(screen.getByPlaceholderText('Type a command or search'), 'theme');
    expect(await screen.findByText('Toggle light and dark theme')).toBeInTheDocument();
    expect(screen.queryByText('Show keyboard shortcuts')).not.toBeInTheDocument();
  });
});
