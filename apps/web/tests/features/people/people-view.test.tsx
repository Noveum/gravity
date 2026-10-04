import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { PersonRow } from '@gravity/shared/records';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { serveJson } from '../../support/fetch.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { personFixture } from '../../support/record-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/people');
stubLayoutSize(1200, 800);
afterAll(() => setViewport(false));

const { PeopleView } = await import('@/features/people/people-view.tsx');
const { neighbourOf } = await import('@/lib/record-trail.ts');
const { PEOPLE_ROOT } = await import('@/lib/query/keys.ts');

function person(id: string, name: string): PersonRow {
  return personFixture({
    id,
    name,
    emails: [`${id}@acme.io`],
    primaryEmail: `${id}@acme.io`,
    companyName: 'Acme',
    syncId: 1,
  });
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  setViewport(true);
  navigation.search = '';
  navigation.push.mockClear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('PeopleView', () => {
  test('lists people and opens the focused one with Enter, remembering the trail', async () => {
    serveJson(() => ({
      body: {
        people: [person('per1', 'Ada Lovelace'), person('per2', 'Grace Hopper')],
        nextCursor: null,
      },
    }));
    renderWithClient(<PeopleView />);
    expect(await screen.findByTestId('record-row-per1')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('record-row-per1')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('j');
    expect(screen.getByTestId('record-row-per2')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Grace Hopper, per2@acme.io, Acme');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/people/per2'));
    expect(neighbourOf('/people', 'per2', -1)).toBe('per1');
  });

  test('when the focused person leaves the list, focus moves to the next one, not the top', async () => {
    const ada = person('per1', 'Ada Lovelace');
    const grace = person('per2', 'Grace Hopper');
    const alan = person('per3', 'Alan Turing');
    serveJson(() => ({ body: { people: [ada, grace, alan], nextCursor: null } }));
    const { client } = renderWithClient(<PeopleView />);
    await screen.findByTestId('record-row-per1');
    await userEvent.keyboard('j');
    expect(screen.getByTestId('record-row-per2')).toHaveAttribute('data-active', 'true');
    const [query] = client.getQueryCache().findAll({ queryKey: [PEOPLE_ROOT] });
    if (query === undefined) throw new Error('missing people query');
    act(() => {
      client.setQueryData(query.queryKey, {
        pages: [{ people: [ada, alan], nextCursor: null }],
        pageParams: [null],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('record-row-per3')).toHaveAttribute('data-active', 'true'),
    );
    expect(screen.getByTestId('record-row-per1')).not.toHaveAttribute('data-active');
  });

  test('Cmd+Shift+A copies the focused person for an agent', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const sent = serveJson((url) =>
      url.pathname === '/api/context'
        ? {
            body: {
              subject: { type: 'person', id: 'per2' },
              label: 'Grace Hopper',
              text: 'Person: Grace Hopper',
            },
          }
        : {
            body: {
              people: [person('per1', 'Ada Lovelace'), person('per2', 'Grace Hopper')],
              nextCursor: null,
            },
          },
    );
    renderWithClient(<PeopleView />);
    await screen.findByTestId('record-row-per1');
    await userEvent.keyboard('j');
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Grace Hopper'));
    expect(sent.find((entry) => entry.url.startsWith('/api/context'))?.url).toBe(
      '/api/context?ref=per2',
    );
    expect(await screen.findByText('Copied Grace Hopper')).toBeInTheDocument();
  });

  test('clicking a row remembers the trail too', async () => {
    serveJson(() => ({
      body: {
        people: [person('per1', 'Ada Lovelace'), person('per3', 'Alan Turing')],
        nextCursor: null,
      },
    }));
    renderWithClient(<PeopleView />);
    const link = await screen.findByRole('link', { name: /Alan Turing/ });
    expect(link).toHaveAttribute('href', '/people/per3');
    fireEvent.click(link);
    expect(neighbourOf('/people', 'per3', -1)).toBe('per1');
  });

  test('an empty workspace says how to add people', async () => {
    serveJson(() => ({ body: { people: [], nextCursor: null } }));
    renderWithClient(<PeopleView />);
    expect(await screen.findByText('No people yet.')).toBeInTheDocument();
    expect(screen.getByText('Press C to add a person, or import a CSV.')).toBeInTheDocument();
  });

  test('a filter that matches nobody offers Shift+F', async () => {
    navigation.search = 'q=nobody';
    const sent = serveJson(() => ({ body: { people: [], nextCursor: null } }));
    renderWithClient(<PeopleView />);
    expect(await screen.findByText('No people match these filters.')).toBeInTheDocument();
    expect(screen.getByText('Press Shift+F to clear them.')).toBeInTheDocument();
    expect(sent[0]?.url).toContain('q=nobody');
  });

  test('a failed load names what failed and offers Retry', async () => {
    serveJson(() => ({
      status: 500,
      body: { error: { code: 'internal', message: 'The database is down.' } },
    }));
    renderWithClient(<PeopleView />);
    expect(await screen.findByText('Could not load people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
