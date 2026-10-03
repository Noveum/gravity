import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { serveJson } from '../../support/fetch.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { companyFixture } from '../../support/record-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/companies');
stubLayoutSize(1200, 800);
afterAll(() => setViewport(false));

const { CompaniesView } = await import('@/features/companies/companies-view.tsx');
const { neighbourOf } = await import('@/lib/record-trail.ts');

const companies = [
  companyFixture({ id: 'c1', name: 'Acme', segment: 'Fintech', size: '51-200' }),
  companyFixture({
    id: 'c2',
    name: 'Globex',
    domains: ['globex.com'],
    primaryDomain: 'globex.com',
  }),
  companyFixture({ id: 'c3', name: 'Initech', domains: [], primaryDomain: null }),
];

const realFetch = globalThis.fetch;
beforeEach(() => {
  setViewport(true);
  navigation.search = '';
  navigation.push.mockClear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('CompaniesView', () => {
  test('lists companies with their domain, segment and size', async () => {
    const sent = serveJson(() => ({ body: { companies, nextCursor: null } }));
    renderWithClient(<CompaniesView />);
    const acme = await screen.findByTestId('record-row-c1');
    expect(acme).toHaveTextContent('Acme');
    expect(acme).toHaveTextContent('acme.io');
    expect(acme).toHaveTextContent('Fintech');
    expect(acme).toHaveTextContent('51-200');
    expect(sent[0]?.url.startsWith('/api/companies')).toBe(true);
  });

  test('J, K and O move and open, remembering the trail', async () => {
    serveJson(() => ({ body: { companies, nextCursor: null } }));
    renderWithClient(<CompaniesView />);
    await screen.findByTestId('record-row-c1');
    await userEvent.keyboard('jjk');
    expect(screen.getByTestId('record-row-c2')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Globex, globex.com');
    await userEvent.keyboard('o');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/companies/c2'));
    expect(neighbourOf('/companies', 'c2', 1)).toBe('c3');
    expect(neighbourOf('/companies', 'c2', -1)).toBe('c1');
  });

  test('an empty workspace says where companies come from', async () => {
    serveJson(() => ({ body: { companies: [], nextCursor: null } }));
    renderWithClient(<CompaniesView />);
    expect(await screen.findByText('No companies yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Companies appear when you add people with a work email or domain.'),
    ).toBeInTheDocument();
  });

  test('a filter that matches nothing offers Shift+F', async () => {
    navigation.search = 'q=nothing';
    serveJson(() => ({ body: { companies: [], nextCursor: null } }));
    renderWithClient(<CompaniesView />);
    expect(await screen.findByText('No companies match these filters.')).toBeInTheDocument();
    expect(screen.getByText('Press Shift+F to clear them.')).toBeInTheDocument();
  });

  test('a failed load names what failed', async () => {
    serveJson(() => ({
      status: 500,
      body: { error: { code: 'internal', message: 'The database is down.' } },
    }));
    renderWithClient(<CompaniesView />);
    expect(await screen.findByText('Could not load companies')).toBeInTheDocument();
  });
});
