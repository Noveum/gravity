'use client';

import type { ImportReport, ImportRowOutcome } from '@gravity/shared/import';
import { Badge } from '@/components/ui/badge.tsx';

export const SHOWN_ROWS = 200;

const STATUS_LABELS: Readonly<Record<ImportRowOutcome['status'], string>> = {
  create: 'New',
  merge: 'Merged',
  unchanged: 'Unchanged',
  skipped: 'Skipped',
  invalid: 'Invalid',
};

const STATUS_TONES = {
  create: 'accent',
  merge: 'neutral',
  unchanged: 'outline',
  skipped: 'warning',
  invalid: 'danger',
} as const;

export function isProblem(row: ImportRowOutcome): boolean {
  return row.status === 'invalid' || row.status === 'skipped';
}

export function writesSomething(row: ImportRowOutcome): boolean {
  if (isProblem(row)) return false;
  return row.status === 'create' || row.status === 'merge' || row.lead === 'create';
}

export function rowsToWrite(report: ImportReport): number {
  return report.rows.filter(writesSomething).length;
}

function shownRows(rows: readonly ImportRowOutcome[]): readonly ImportRowOutcome[] {
  if (rows.length <= SHOWN_ROWS) return rows;
  const problems = rows.filter(isProblem);
  const rest = rows.filter((row) => !isProblem(row));
  return [...problems, ...rest].slice(0, SHOWN_ROWS);
}

function leadText(row: ImportRowOutcome, preview: boolean): string {
  if (row.lead === 'exists') return `${row.leadKey ?? 'Open lead'} already open`;
  if (row.lead === 'create') return preview ? 'New lead' : (row.leadKey ?? 'New lead');
  return '';
}

const MATCH_LABELS: Readonly<Record<NonNullable<ImportRowOutcome['matchedBy']>, string>> = {
  source_id: 'source id',
  linkedin_provider_id: 'LinkedIn id',
  email: 'email',
  linkedin_url: 'LinkedIn URL',
  domain: 'domain',
  name: 'name',
};

function noteText(row: ImportRowOutcome): string {
  if (row.issues.length > 0) return row.issues.map((issue) => issue.message).join(' ');
  return [
    row.matchedBy === null ? '' : `Matched by ${MATCH_LABELS[row.matchedBy]}`,
    row.kept.length > 0 ? `Kept what a person set: ${row.kept.join(', ')}` : '',
    row.changes.length > 0 ? `Updates ${row.changes.join(', ')}` : '',
  ]
    .filter((part) => part.length > 0)
    .join('. ');
}

export function ImportReportView({ report }: { readonly report: ImportReport }) {
  const preview = report.mode === 'preview';
  const totals = report.totals;
  const chips: readonly (readonly [number, string])[] = [
    [totals.created, 'new'],
    [totals.merged, 'merged'],
    [totals.unchanged, 'unchanged'],
    [totals.skipped, 'skipped'],
    [totals.invalid, 'invalid'],
    [totals.companiesCreated, preview ? 'companies to create' : 'companies created'],
    [totals.leadsCreated, preview ? 'leads to create' : 'leads created'],
    [totals.leadsExisting, 'leads already open'],
  ];
  const shown = shownRows(report.rows);
  return (
    <section aria-label={preview ? 'Preview' : 'Result'} className="flex flex-col gap-3">
      <ul aria-label="Totals" className="flex flex-wrap gap-2">
        {chips
          .filter(([total, label]) => total > 0 || label === 'new')
          .map(([total, label]) => (
            <li key={label}>
              <Badge data-numeric>{`${total} ${label}`}</Badge>
            </li>
          ))}
      </ul>
      {report.failure === null ? null : (
        <p role="alert" className="text-danger text-dense">
          Stopped at row {report.failure.row}: {report.failure.message}
        </p>
      )}
      <table className="w-full table-fixed text-dense">
        <caption className="sr-only">
          {preview ? 'What the import will do' : 'What the import did'}
        </caption>
        <thead>
          <tr className="h-7 text-left text-2xs text-faint uppercase tracking-wide">
            <th className="w-12 font-medium">Row</th>
            <th className="w-48 font-medium">Record</th>
            <th className="w-24 font-medium">Status</th>
            <th className="w-36 font-medium">Lead</th>
            <th className="font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.row} className="h-7 border-border border-t">
              <td data-numeric className="text-faint">
                {row.row}
              </td>
              <td className="truncate pr-3 text-text" title={row.label}>
                {row.label}
              </td>
              <td>
                <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
              </td>
              <td className="truncate pr-3 text-muted">{leadText(row, preview)}</td>
              <td className="truncate text-muted" title={noteText(row)}>
                {noteText(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.rows.length > SHOWN_ROWS ? (
        <p className="text-2xs text-faint">
          Showing {SHOWN_ROWS} of {report.rows.length} rows, rows with a problem first.
        </p>
      ) : null}
    </section>
  );
}
