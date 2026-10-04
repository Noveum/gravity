import { describe, expect, test } from 'bun:test';
import {
  type ImportReport,
  type ImportRowOutcome,
  importReportSchema,
  importRowOutcomeSchema,
  totalsOf,
} from '../../src/import/report.ts';

function outcome(overrides: Partial<ImportRowOutcome>): ImportRowOutcome {
  return {
    row: 1,
    status: 'create',
    label: 'Ada',
    matchedBy: null,
    recordId: null,
    changes: [],
    kept: [],
    company: 'none',
    lead: 'none',
    leadKey: null,
    issues: [],
    ...overrides,
  };
}

describe('totalsOf', () => {
  test('counts statuses, and companies and leads only on rows that are written', () => {
    expect(
      totalsOf(
        [
          outcome({ status: 'create', company: 'create', lead: 'create' }),
          outcome({ status: 'merge', lead: 'exists' }),
          outcome({ status: 'unchanged', company: 'match' }),
          outcome({ status: 'invalid', company: 'create', lead: 'create' }),
          outcome({ status: 'skipped' }),
        ],
        6,
      ),
    ).toEqual({
      rows: 6,
      processed: 5,
      created: 1,
      merged: 1,
      unchanged: 1,
      skipped: 1,
      invalid: 1,
      companiesCreated: 1,
      leadsCreated: 1,
      leadsExisting: 1,
    });
  });
});

describe('report schemas', () => {
  test('an outcome and a report round trip through their schemas', () => {
    const row = outcome({ status: 'merge', matchedBy: 'linkedin_provider_id', lead: 'exists' });
    expect(importRowOutcomeSchema.parse(row)).toEqual(row);
    const report: ImportReport = {
      mode: 'preview',
      status: 'completed',
      target: 'leads',
      totals: totalsOf([row], 1),
      rows: [row],
      failure: null,
    };
    expect(importReportSchema.parse(report)).toEqual(report);
    expect(importRowOutcomeSchema.safeParse({ ...row, matchedBy: 'phone' }).success).toBe(false);
  });
});
