'use client';

import { personFilterRegistry } from '@gravity/shared/filters';
import type { PersonRow } from '@gravity/shared/records';
import { useMemo } from 'react';
import type { RecordColumn } from '@/features/records/record-list.tsx';
import { RecordListView, useRecordListQuery } from '@/features/records/record-list-view.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { usePeopleList } from '@/lib/query/use-records.ts';

const COPY = {
  errorTitle: 'Could not load people',
  emptyTitle: 'No people yet.',
  emptyDescription: 'Press C to add a person, or import a CSV.',
  filteredTitle: 'No people match these filters.',
} as const;

const COLUMNS: readonly RecordColumn<PersonRow>[] = [
  { key: 'company', className: 'hidden w-48 text-muted md:block', read: (row) => row.companyName },
  { key: 'title', className: 'hidden w-40 text-faint lg:block', read: (row) => row.title },
];

function describePerson(person: PersonRow): string {
  return [person.name, person.primaryEmail ?? 'no email', person.companyName ?? 'no company'].join(
    ', ',
  );
}

export function PeopleView() {
  const workspace = useWorkspace();
  const registry = useMemo(
    () => personFilterRegistry(workspace.fieldsFor('person', null)),
    [workspace],
  );
  const state = useRecordListQuery('person', registry);
  const list = usePeopleList(state.query);
  return (
    <RecordListView
      object="person"
      registry={registry}
      state={state}
      result={list}
      copy={COPY}
      rows={list.people}
      basePath="/people"
      title={(person) => person.name}
      detail={(person) => person.primaryEmail}
      columns={COLUMNS}
      describe={describePerson}
    />
  );
}
