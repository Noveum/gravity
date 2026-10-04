'use client';

import type { LeadRow } from '@gravity/shared/records';
import Link from 'next/link';
import { cn } from '@/lib/cn.ts';
import { listRowHover } from '@/lib/interaction.ts';
import type { CompanyRecord as CompanyRecordData } from '@/lib/query/schemas.ts';
import { useCompanyRecord } from '@/lib/query/use-records.ts';
import { setRecordTrail, useTrailKeys } from '@/lib/record-trail.ts';
import { CompanyAttributes } from './record-attributes.tsx';
import { RecordFallback, RecordLayout, recordHeadingClass } from './record-layout.tsx';

function CompanyPeople({
  people,
  leads,
}: {
  readonly people: CompanyRecordData['people'];
  readonly leads: readonly LeadRow[];
}) {
  const ids = people.map(({ person }) => person.id);
  return (
    <section aria-label="People" className="flex flex-col gap-1">
      <h2 className={recordHeadingClass}>People</h2>
      {people.length === 0 ? <p className="text-dense text-muted">Nobody works here yet.</p> : null}
      <div className="-mx-1 flex flex-col">
        {people.map(({ person, employment }) => (
          <Link
            key={person.id}
            href={`/people/${person.id}`}
            prefetch={false}
            onClick={() => setRecordTrail('/people', ids)}
            className={cn(
              'flex h-7 items-center gap-2 rounded-md px-1 text-dense text-text',
              listRowHover,
            )}
          >
            <span className="truncate">{person.name}</span>
            {employment.title === null ? null : (
              <span className="truncate text-muted">{employment.title}</span>
            )}
            <span className="ml-auto flex shrink-0 gap-1">
              {leads
                .filter((lead) => lead.personId === person.id)
                .map((lead) => (
                  <span
                    key={lead.id}
                    data-numeric
                    className="rounded-sm border border-border px-1 text-2xs text-faint"
                  >
                    {lead.key}
                  </span>
                ))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function CompanyRecord({ companyId }: { readonly companyId: string }) {
  const record = useCompanyRecord(companyId);
  useTrailKeys('/companies', companyId);
  if (record.data === undefined) {
    return (
      <RecordFallback
        pending={record.isPending}
        error={record.error}
        errorTitle="Could not load this company"
        onRetry={() => {
          record.refetch().catch(() => undefined);
        }}
      />
    );
  }
  const { company, people, leads } = record.data;
  return (
    <RecordLayout
      recordId={company.id}
      subjectType="company"
      title={company.name}
      subtitle={company.primaryDomain}
      attributes={<CompanyAttributes company={company} />}
      sections={<CompanyPeople people={people} leads={leads} />}
      leads={leads}
      focusLeadId={null}
      linkFor={() => `/companies/${company.id}`}
    />
  );
}
