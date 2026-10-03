'use client';

import type { ActivityRow } from '@gravity/shared/records';
import { Bot } from 'lucide-react';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { describeActivity } from './describe-activity.ts';

export function ActivityItem({ activity }: { readonly activity: ActivityRow }) {
  const workspace = useWorkspace();
  const sentence = describeActivity(activity, {
    memberName: (id) => workspace.memberByUserId.get(id)?.name,
  });
  return (
    <div
      className="flex items-start gap-2 py-1.5 text-dense"
      data-testid={`activity-${activity.id}`}
    >
      {activity.actor.type === 'agent' ? (
        <Bot role="img" aria-label="Agent" className="mt-0.5 size-3.5 shrink-0 text-accent" />
      ) : null}
      <p className="min-w-0 flex-1 text-muted">{sentence}</p>
      <span className="shrink-0 text-2xs text-faint">
        <RelativeTime at={activity.occurredAt} />
      </span>
    </div>
  );
}
