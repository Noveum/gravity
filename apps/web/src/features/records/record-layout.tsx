'use client';

import type { ActivityEntityType } from '@gravity/shared/constants';
import type { LeadRow } from '@gravity/shared/records';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import type { VerbMode, VerbRequest } from '@/features/leads/lead-verb-menu.tsx';
import { LeadVerbs } from '@/features/leads/lead-verbs.tsx';
import type { LeadListSelection } from '@/features/leads/use-lead-cursor.tsx';
import { ComposerPlaceholder } from '@/features/timeline/composer-placeholder.tsx';
import { Timeline } from '@/features/timeline/timeline.tsx';
import { useCopyLinkTarget } from '@/lib/copy-link.tsx';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { watchWindowRefocus } from '@/lib/window-refocus.ts';
import { LeadCard } from './lead-card.tsx';

export const RECORD_VERBS: readonly VerbMode[] = ['stage', 'owner', 'priority', 'hold', 'close'];

export const recordHeadingClass = 'font-medium text-2xs text-faint uppercase tracking-wide';

const NO_OP = () => undefined;
const SKELETON_ATTRIBUTES = ['a', 'b', 'c', 'd', 'e'];

export interface RecordLayoutProps {
  readonly recordId: string;
  readonly subjectType: ActivityEntityType;
  readonly title: string;
  readonly subtitle: string | null;
  readonly attributes: ReactNode;
  readonly sections?: ReactNode;
  readonly leads: readonly LeadRow[];
  readonly focusLeadId: string | null;
  readonly linkFor: (leadId: string | null) => string;
}

function useRecordSelection(focused: LeadRow | undefined): {
  readonly selection: LeadListSelection;
  readonly requestVerb: (request: VerbRequest) => void;
} {
  const [request, setRequest] = useState<VerbRequest | null>(null);
  const settleRequest = useCallback(() => setRequest(null), []);
  const selection = useMemo<LeadListSelection>(
    () => ({
      targets: focused === undefined ? [] : [focused],
      active: focused,
      hasSelection: false,
      selectionLeft: false,
      request,
      settleRequest,
      clear: NO_OP,
    }),
    [focused, request, settleRequest],
  );
  return { selection, requestVerb: setRequest };
}

export function RecordLayout({
  recordId,
  subjectType,
  title,
  subtitle,
  attributes,
  sections,
  leads,
  focusLeadId,
  linkFor,
}: RecordLayoutProps) {
  const [focusedId, setFocusedId] = useState<string | null>(focusLeadId);
  const focused = leads.find((lead) => lead.id === focusedId) ?? leads[0];
  const { selection, requestVerb } = useRecordSelection(focused);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useCopyLinkTarget(linkFor(focused?.id ?? null));
  useEffect(() => watchWindowRefocus(), []);
  const returnFocus = () => {
    const card = focused === undefined ? null : document.getElementById(`lead-card-${focused.id}`);
    (card ?? heading.current)?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex flex-col gap-5 border-border p-4 lg:min-h-0 lg:overflow-y-auto lg:border-r">
        <header className="flex flex-col gap-0.5">
          <h1 ref={heading} tabIndex={-1} className="font-medium text-lg text-text">
            {title}
          </h1>
          {subtitle === null ? null : <p className="text-dense text-muted">{subtitle}</p>}
        </header>
        {attributes}
        {sections}
        <section aria-label="Leads" className="flex flex-col gap-2">
          <h2 className={recordHeadingClass}>Leads</h2>
          {leads.length === 0 ? (
            <p className="text-dense text-muted">No leads yet. Press C to add one.</p>
          ) : null}
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              focused={lead.id === focused?.id}
              onFocus={() => setFocusedId(lead.id)}
              onVerb={(next) => {
                setFocusedId(next.lead.id);
                requestVerb(next);
              }}
            />
          ))}
        </section>
        {focused === undefined ? null : (
          <LeadVerbs
            selection={selection}
            pipelineId={focused.pipelineId}
            anchorPrefix="lead-card-"
            verbs={RECORD_VERBS}
          />
        )}
      </div>
      <div className="flex h-[70vh] min-h-0 shrink-0 flex-col border-border border-t lg:h-auto lg:border-t-0">
        <Timeline subjectType={subjectType} subjectId={recordId} />
        <ComposerPlaceholder onEscape={returnFocus} />
      </div>
    </div>
  );
}

function RecordSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col gap-4 p-4 lg:w-[420px]"
    >
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3 w-32" />
      {SKELETON_ATTRIBUTES.map((row) => (
        <div key={row} className="flex h-7 items-center gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}

export function RecordFallback({
  pending,
  error,
  errorTitle,
  onRetry,
}: {
  readonly pending: boolean;
  readonly error: Error | null;
  readonly errorTitle: string;
  readonly onRetry: () => void;
}) {
  const loading = useDelayedFlag(pending);
  if (error !== null) return <ErrorState title={errorTitle} error={error} onRetry={onRetry} />;
  return loading ? <RecordSkeleton /> : null;
}
