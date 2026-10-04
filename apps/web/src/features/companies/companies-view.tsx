'use client';

import { companyFilterRegistry } from '@gravity/shared/filters';
import type { CompanyRow } from '@gravity/shared/records';
import { useMemo } from 'react';
import { ImportLink } from '@/features/import/import-link.tsx';
import type { RecordColumn } from '@/features/records/record-list.tsx';
import { RecordListView, useRecordListQuery } from '@/features/records/record-list-view.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useCompanyList } from '@/lib/query/use-records.ts';

const COPY = {
  errorTitle: 'Could not load companies',
  emptyTitle: 'No companies yet.',
  emptyDescription: 'Companies appear when you add people with a work email or domain.',
  filteredTitle: 'No companies match these filters.',
  emptyAction: <ImportLink href="/import?target=companies" />,
} as const;

const COLUMNS: readonly RecordColumn<CompanyRow>[] = [
  { key: 'segment', className: 'hidden w-40 text-muted md:block', read: (row) => row.segment },
  { key: 'size', className: 'hidden w-24 text-faint lg:block', read: (row) => row.size },
];

function describeCompany(company: CompanyRow): string {
  return [company.name, company.primaryDomain ?? 'no domain'].join(', ');
}

export function CompaniesView() {
  const workspace = useWorkspace();
  const registry = useMemo(
    () => companyFilterRegistry(workspace.fieldsFor('company', null)),
    [workspace],
  );
  const state = useRecordListQuery('company', registry);
  const list = useCompanyList(state.query);
  return (
    <RecordListView
      object="company"
      registry={registry}
      state={state}
      result={list}
      copy={COPY}
      rows={list.companies}
      basePath="/companies"
      title={(company) => company.name}
      detail={(company) => company.primaryDomain}
      columns={COLUMNS}
      describe={describeCompany}
    />
  );
}
