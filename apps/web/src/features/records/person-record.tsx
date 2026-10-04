'use client';

import { usePersonRecord } from '@/lib/query/use-records.ts';
import { useTrailKeys } from '@/lib/record-trail.ts';
import { PersonAttributes } from './record-attributes.tsx';
import { RecordFallback, RecordLayout } from './record-layout.tsx';

export function PersonRecord({
  personId,
  focusLeadId,
}: {
  readonly personId: string;
  readonly focusLeadId: string | null;
}) {
  const record = usePersonRecord(personId);
  useTrailKeys('/people', personId);
  if (record.data === undefined) {
    return (
      <RecordFallback
        pending={record.isPending}
        error={record.error}
        errorTitle="Could not load this person"
        onRetry={() => {
          record.refetch().catch(() => undefined);
        }}
      />
    );
  }
  const { person, leads } = record.data;
  const subtitle = [person.title, person.companyName]
    .filter((part) => part !== null && part !== '')
    .join(' at ');
  return (
    <RecordLayout
      recordId={person.id}
      subjectType="person"
      title={person.name}
      subtitle={subtitle === '' ? null : subtitle}
      attributes={<PersonAttributes person={person} />}
      leads={leads}
      focusLeadId={focusLeadId}
      linkFor={(leadId) =>
        leadId === null ? `/people/${person.id}` : `/people/${person.id}?lead=${leadId}`
      }
    />
  );
}
