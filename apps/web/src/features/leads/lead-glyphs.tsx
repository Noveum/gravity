import {
  LEAD_PRIORITY_LABELS,
  type LeadPriority,
  OWED_BY_LABELS,
  type OwedBy,
  type StageCategory,
} from '@gravity/shared/constants';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleX,
  SignalHigh,
  SignalLow,
  SignalMedium,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/cn.ts';

const STAGE_GLYPH: Readonly<Record<StageCategory, { icon: LucideIcon; tone: string }>> = {
  open: { icon: CircleDot, tone: 'text-state-started' },
  hold: { icon: CirclePause, tone: 'text-warning' },
  won: { icon: CircleCheck, tone: 'text-state-completed' },
  lost: { icon: CircleX, tone: 'text-state-canceled' },
};

export function StageGlyph({
  category,
  label,
}: {
  readonly category: StageCategory;
  readonly label: string;
}) {
  const { icon: Icon, tone } = STAGE_GLYPH[category];
  return (
    <Icon role="img" aria-label={label} className={cn('size-3.5 shrink-0', tone)} strokeWidth={2} />
  );
}

const PRIORITY_GLYPH: Readonly<Record<LeadPriority, { icon: LucideIcon; tone: string }>> = {
  0: { icon: CircleDashed, tone: 'text-priority-none' },
  1: { icon: TriangleAlert, tone: 'text-priority-urgent' },
  2: { icon: SignalHigh, tone: 'text-priority-high' },
  3: { icon: SignalMedium, tone: 'text-priority-medium' },
  4: { icon: SignalLow, tone: 'text-priority-low' },
};

export function asPriority(value: number): LeadPriority {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 0;
}

export function PriorityGlyph({ priority }: { readonly priority: number }) {
  const level = asPriority(priority);
  const { icon: Icon, tone } = PRIORITY_GLYPH[level];
  return (
    <Icon
      role="img"
      aria-label={LEAD_PRIORITY_LABELS[level]}
      className={cn('size-3.5 shrink-0', tone)}
      strokeWidth={2}
    />
  );
}

export function OwedByChip({ owedBy }: { readonly owedBy: OwedBy }) {
  if (owedBy === 'none') return null;
  return (
    <span
      title={OWED_BY_LABELS[owedBy]}
      className={cn(
        'inline-flex h-4 shrink-0 items-center rounded-sm border px-1 font-medium text-2xs',
        owedBy === 'us' ? 'border-warning text-warning' : 'border-border text-muted',
      )}
    >
      {owedBy === 'us' ? 'Us' : 'Them'}
    </span>
  );
}
