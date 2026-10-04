import { z } from 'zod';
import { IMPORT_TARGETS } from './constants.ts';

export const IMPORT_ROW_STATUSES = ['create', 'merge', 'unchanged', 'skipped', 'invalid'] as const;
export const IMPORT_COMPANY_OUTCOMES = ['create', 'match', 'planned', 'none'] as const;
export const IMPORT_LEAD_OUTCOMES = ['create', 'exists', 'none'] as const;
export const IMPORT_MATCHES = [
  'source_id',
  'linkedin_provider_id',
  'email',
  'linkedin_url',
  'domain',
  'name',
] as const;

export const importIssueSchema = z.object({
  row: z.number().int(),
  column: z.string().nullable(),
  message: z.string(),
});

export const importRowOutcomeSchema = z.object({
  row: z.number().int(),
  status: z.enum(IMPORT_ROW_STATUSES),
  label: z.string(),
  matchedBy: z.enum(IMPORT_MATCHES).nullable(),
  recordId: z.string().nullable(),
  changes: z.array(z.string()),
  kept: z.array(z.string()),
  company: z.enum(IMPORT_COMPANY_OUTCOMES),
  lead: z.enum(IMPORT_LEAD_OUTCOMES),
  leadKey: z.string().nullable(),
  issues: z.array(importIssueSchema),
});
export type ImportRowOutcome = z.infer<typeof importRowOutcomeSchema>;

export const importTotalsSchema = z.object({
  rows: z.number().int(),
  processed: z.number().int(),
  created: z.number().int(),
  merged: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
  invalid: z.number().int(),
  companiesCreated: z.number().int(),
  leadsCreated: z.number().int(),
  leadsExisting: z.number().int(),
});
export type ImportTotals = z.infer<typeof importTotalsSchema>;

export const importReportSchema = z.object({
  mode: z.enum(['preview', 'commit']),
  status: z.enum(['completed', 'partial']),
  target: z.enum(IMPORT_TARGETS),
  totals: importTotalsSchema,
  rows: z.array(importRowOutcomeSchema),
  failure: z.object({ row: z.number().int(), message: z.string() }).nullable(),
});
export type ImportReport = z.infer<typeof importReportSchema>;

function isWritten(row: ImportRowOutcome): boolean {
  return row.status !== 'invalid' && row.status !== 'skipped';
}

export function totalsOf(rows: readonly ImportRowOutcome[], planned: number): ImportTotals {
  const count = (matches: (row: ImportRowOutcome) => boolean) => rows.filter(matches).length;
  return {
    rows: planned,
    processed: rows.length,
    created: count((row) => row.status === 'create'),
    merged: count((row) => row.status === 'merge'),
    unchanged: count((row) => row.status === 'unchanged'),
    skipped: count((row) => row.status === 'skipped'),
    invalid: count((row) => row.status === 'invalid'),
    companiesCreated: count((row) => isWritten(row) && row.company === 'create'),
    leadsCreated: count((row) => isWritten(row) && row.lead === 'create'),
    leadsExisting: count((row) => isWritten(row) && row.lead === 'exists'),
  };
}
