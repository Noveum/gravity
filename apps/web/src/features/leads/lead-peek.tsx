'use client';

import { LEAD_PRIORITY_LABELS, OWED_BY_LABELS } from '@gravity/shared/constants';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ActivityItem } from '@/features/timeline/activity-item.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { tabHover } from '@/lib/interaction.ts';
import { useLead } from '@/lib/query/use-leads.ts';
import { useTimeline } from '@/lib/query/use-records.ts';
import { asPriority, PriorityGlyph, StageGlyph } from './lead-glyphs.tsx';
import { personHref } from './lead-groups.ts';

const RECENT_ACTIVITY = 10;

function Property({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-3 text-dense">
      <dt className="w-24 shrink-0 text-faint">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1.5 text-text">{children}</dd>
    </div>
  );
}

function PeekSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function LeadPeek({ leadId }: { readonly leadId: string }) {
  const workspace = useWorkspace();
  const lead = useLead(leadId).data;
  const timeline = useTimeline('lead', leadId, 'all');
  if (lead === undefined) return <PeekSkeleton />;
  const stage = workspace.stageById.get(lead.stageId);
  const owner = lead.ownerId === null ? undefined : workspace.memberByUserId.get(lead.ownerId);
  const activities = timeline.activities.slice(0, RECENT_ACTIVITY);
  return (
    <section className="flex flex-col" data-testid="lead-peek">
      <div className="flex flex-col gap-4 p-4">
        <header className="flex flex-col gap-0.5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 truncate font-medium text-base text-text">{lead.personName}</h2>
            <Link
              href={personHref(lead)}
              className={`flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-faint ${tabHover}`}
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
              Open record
            </Link>
          </div>
          {lead.companyName === null ? null : (
            <p className="text-dense text-muted">{lead.companyName}</p>
          )}
          {lead.personEmail === null ? null : (
            <p className="text-2xs text-faint">{lead.personEmail}</p>
          )}
        </header>
        <dl className="flex flex-col">
          <Property label="Stage">
            {stage === undefined ? null : (
              <StageGlyph category={stage.category} label={stage.name} />
            )}
            <span className="truncate">{stage?.name ?? 'Unknown stage'}</span>
          </Property>
          <Property label="Priority">
            <PriorityGlyph priority={lead.priority} />
            {LEAD_PRIORITY_LABELS[asPriority(lead.priority)]}
          </Property>
          <Property label="Owner">{owner?.name ?? 'Unassigned'}</Property>
          <Property label="Next action">
            <span className="truncate">{lead.nextAction ?? 'None'}</span>
            {lead.nextActionAt === null ? null : (
              <span data-numeric className="shrink-0 text-2xs text-faint">
                <RelativeTime at={lead.nextActionAt} />
              </span>
            )}
          </Property>
          <Property label="Waiting on">{OWED_BY_LABELS[lead.owedBy]}</Property>
          {lead.holdReason === null ? null : (
            <Property label="On hold">
              <span className="truncate">{lead.holdReason}</span>
            </Property>
          )}
        </dl>
        <div className="flex flex-col">
          <h3 className="font-medium text-2xs text-faint uppercase tracking-wide">
            Recent activity
          </h3>
          {activities.length === 0 && !timeline.isPending ? (
            <p className="py-1.5 text-dense text-faint">Nothing yet.</p>
          ) : null}
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      </div>
    </section>
  );
}
