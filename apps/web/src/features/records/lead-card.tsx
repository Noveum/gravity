'use client';

import type { LeadRow } from '@gravity/shared/records';
import type { FocusEvent } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { StageGlyph } from '@/features/leads/lead-glyphs.tsx';
import { LeadVerbMenu, type VerbMode, type VerbRequest } from '@/features/leads/lead-verb-menu.tsx';
import { BrandDot } from '@/features/workspace/brand-dot.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import { isWindowRefocus } from '@/lib/window-refocus.ts';

export interface LeadCardProps {
  readonly lead: LeadRow;
  readonly focused: boolean;
  readonly onFocus: () => void;
  readonly onVerb: (request: VerbRequest) => void;
}

const KEYLESS_ON_RECORDS: readonly VerbMode[] = ['nextAction'];

export function LeadCard({ lead, focused, onFocus, onVerb }: LeadCardProps) {
  const workspace = useWorkspace();
  const pipeline = workspace.pipelineById.get(lead.pipelineId);
  const brand = workspace.brandById.get(lead.brandId);
  const stage = workspace.stageById.get(lead.stageId);
  const owner = lead.ownerId === null ? undefined : workspace.memberByUserId.get(lead.ownerId);
  const focusByUser = (event: FocusEvent<HTMLButtonElement>) => {
    if (!isWindowRefocus(event)) onFocus();
  };
  return (
    <div className="group relative">
      <button
        type="button"
        id={`lead-card-${lead.id}`}
        data-testid={`lead-card-${lead.key}`}
        aria-current={focused ? 'true' : undefined}
        onFocus={focusByUser}
        onClick={onFocus}
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-left text-dense',
          cardHover,
          focused && 'border-accent hover:border-accent',
        )}
      >
        <span className="flex items-center gap-2 pr-6 text-muted">
          {brand === undefined ? null : <BrandDot color={brand.color} />}
          <span className="truncate">
            {[brand?.name, pipeline?.name].filter((part) => part !== undefined).join(' · ')}
          </span>
          <span data-numeric className="ml-auto shrink-0 text-2xs text-faint">
            {lead.key}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-text">
          {stage === undefined ? null : <StageGlyph category={stage.category} label={stage.name} />}
          <span className="truncate">{stage?.name ?? 'Unknown stage'}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
            {owner === undefined ? null : <Avatar name={owner.name} src={owner.image} size="xs" />}
            {owner?.name ?? 'Unassigned'}
          </span>
        </span>
        {lead.nextAction === null ? null : (
          <span className="truncate text-muted">
            Next: {lead.nextAction}
            {lead.nextActionAt === null ? null : (
              <span data-numeric className="ml-1 text-2xs text-faint">
                <RelativeTime at={lead.nextActionAt} />
              </span>
            )}
          </span>
        )}
        {lead.holdReason === null ? null : (
          <span className="truncate text-warning">On hold: {lead.holdReason}</span>
        )}
      </button>
      <span className="absolute top-2.5 right-2">
        <LeadVerbMenu lead={lead} visible={focused} unkeyed={KEYLESS_ON_RECORDS} onVerb={onVerb} />
      </span>
    </div>
  );
}
