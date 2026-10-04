import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export const CSV =
  'Full Name,Work Email,Stage\nAda Lovelace,ada@vela.example,Ready\nGrace Hopper,grace@quarry.example,New\n';

export const SUBMIT = '{Meta>}{Enter}{/Meta}';

export function outcome(row: number, label: string, overrides: Record<string, unknown> = {}) {
  return {
    row,
    status: 'create',
    label,
    matchedBy: null,
    recordId: null,
    changes: [],
    kept: [],
    company: 'none',
    lead: 'create',
    leadKey: null,
    issues: [],
    ...overrides,
  };
}

export function report(
  mode: 'preview' | 'commit',
  rows: Record<string, unknown>[] = [outcome(1, 'Ada Lovelace'), outcome(2, 'Grace Hopper')],
) {
  const count = (status: string) => rows.filter((row) => row['status'] === status).length;
  return {
    report: {
      mode,
      status: 'completed',
      target: 'leads',
      totals: {
        rows: rows.length,
        processed: rows.length,
        created: count('create'),
        merged: count('merge'),
        unchanged: count('unchanged'),
        skipped: count('skipped'),
        invalid: count('invalid'),
        companiesCreated: 0,
        leadsCreated: rows.filter((row) => row['lead'] === 'create' && row['status'] !== 'skipped')
          .length,
        leadsExisting: 0,
      },
      rows,
      failure: null,
      resumeFromRow: null as number | null,
    },
  };
}

export function partial(
  rows: Record<string, unknown>[],
  planned: number,
  failure: { row: number | null; message: string },
  mode: 'preview' | 'commit' = 'commit',
) {
  const done = report(mode, rows);
  return {
    report: {
      ...done.report,
      status: 'partial',
      totals: { ...done.report.totals, rows: planned },
      failure,
      resumeFromRow: rows.length + 1,
    },
  };
}

export async function choose(content: string | Uint8Array<ArrayBuffer> = CSV, name = 'people.csv') {
  await userEvent.upload(
    screen.getByLabelText('Import file'),
    new File([content], name, { type: name.endsWith('.json') ? 'application/json' : 'text/csv' }),
  );
}
