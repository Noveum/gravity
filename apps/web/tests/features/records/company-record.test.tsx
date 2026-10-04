import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { serveJson } from '../../support/fetch.ts';
import { stubLayoutSize } from '../../support/layout-size.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { companyFixture, employmentFixture, personFixture } from '../../support/record-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';
import { setViewport } from '../../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/companies/c1');
stubLayoutSize(1400, 900);
afterAll(() => setViewport(false));

const { CompanyRecord } = await import('@/features/records/company-record.tsx');
const { neighbourOf, setRecordTrail } = await import('@/lib/record-trail.ts');

const company = companyFixture({ segment: 'Fintech', location: 'Berlin' });
const ada = personFixture({ companyId: 'c1', companyName: 'Acme', title: 'CTO' });
const grace = personFixture({ id: 'per2', name: 'Grace Hopper', companyId: 'c1' });

const record = {
  company,
  people: [
    { person: ada, employment: employmentFixture({ title: 'CTO' }) },
    { person: grace, employment: employmentFixture({ id: 'e2', personId: 'per2', title: 'VP' }) },
  ],
  leads: [leadFixture({ id: 'l1', key: 'YOD-1', companyId: 'c1', companyName: 'Acme' })],
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
    if (url.pathname === '/api/companies/c1' && method === 'PATCH') {
      return { body: { company: { ...company, ...(body as object), syncId: 6 } } };
    }
    if (url.pathname === '/api/companies/c1') return { body: record };
    return { body: { activities: [], nextCursor: null } };
  });
}

describe('CompanyRecord', () => {
  test('shows the company, its people with their leads, and one card per lead', async () => {
    const sent = serve();
    renderWithClient(<CompanyRecord companyId="c1" />);
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(
      within(screen.getByTestId('record-attributes')).getByText('Fintech'),
    ).toBeInTheDocument();
    const people = screen.getByRole('region', { name: 'People' });
    const adaLink = within(people).getByRole('link', { name: /Ada Lovelace/ });
    expect(adaLink).toHaveAttribute('href', '/people/per1');
    expect(adaLink).toHaveTextContent('YOD-1');
    expect(within(people).getByRole('link', { name: /Grace Hopper/ })).toHaveTextContent('VP');
    expect(screen.getByTestId('lead-card-YOD-1')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        sent.some((entry) =>
          entry.url.startsWith('/api/timeline?subjectType=company&subjectId=c1'),
        ),
      ).toBe(true),
    );
  });

  test('Cmd+Shift+A copies the company, not the lead in focus', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const sent = serveJson((url) => {
      if (url.pathname === '/api/context') {
        return { body: { subject: { type: 'company', id: 'c1' }, text: 'Company: Acme' } };
      }
      if (url.pathname === '/api/companies/c1') return { body: record };
      return { body: { activities: [], nextCursor: null } };
    });
    renderWithClient(<CompanyRecord companyId="c1" />);
    expect(await screen.findByTestId('lead-card-YOD-1')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Company: Acme'));
    expect(sent.find((entry) => entry.url.startsWith('/api/context'))?.url).toBe(
      '/api/context?ref=c1',
    );
  });

  test('renaming the company updates at once and saves', async () => {
    const sent = serve();
    renderWithClient(<CompanyRecord companyId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Name' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Acme Labs{Enter}');
    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument();
    await waitFor(() =>
      expect(sent.find((entry) => entry.method === 'PATCH')?.body).toEqual({ name: 'Acme Labs' }),
    );
  });

  test('opening one of its people remembers them as the trail', async () => {
    serve();
    renderWithClient(<CompanyRecord companyId="c1" />);
    const people = await screen.findByRole('region', { name: 'People' });
    fireEvent.click(within(people).getByRole('link', { name: /Ada Lovelace/ }));
    expect(neighbourOf('/people', 'per1', 1)).toBe('per2');
  });

  test('[ and ] step through the companies list', async () => {
    serve();
    setRecordTrail('/companies', ['c0', 'c1', 'c2']);
    renderWithClient(<CompanyRecord companyId="c1" />);
    await screen.findByRole('heading', { name: 'Acme' });
    await userEvent.keyboard(']');
    expect(navigation.push).toHaveBeenCalledWith('/companies/c2');
    await userEvent.keyboard('[[');
    expect(navigation.push).toHaveBeenCalledWith('/companies/c0');
  });

  test('a company with no leads says how to add one', async () => {
    serveJson((url) =>
      url.pathname === '/api/companies/c1'
        ? { body: { ...record, people: [], leads: [] } }
        : { body: { activities: [], nextCursor: null } },
    );
    renderWithClient(<CompanyRecord companyId="c1" />);
    expect(await screen.findByText('No leads yet. Press C to add one.')).toBeInTheDocument();
    expect(screen.getByText('Nobody works here yet.')).toBeInTheDocument();
    await userEvent.keyboard('n');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Acme' }));
  });
});
