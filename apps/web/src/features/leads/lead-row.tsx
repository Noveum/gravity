'use client';

import type { BrandColor } from '@gravity/shared/constants';
import type { LeadRow, MemberRow } from '@gravity/shared/records';
import Link from 'next/link';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { BrandDot } from '@/features/workspace/brand-dot.tsx';
import { cn } from '@/lib/cn.ts';
import { listRowHover, revealOnHover } from '@/lib/interaction.ts';
import { isWindowRefocus } from '@/lib/window-refocus.ts';
import { OwedByChip, PriorityGlyph } from './lead-glyphs.tsx';
import { personHref } from './lead-groups.ts';

export const LEAD_ROW_HEIGHT = 28;

export interface LeadRowViewProps {
  readonly lead: LeadRow;
  readonly active: boolean;
  readonly selected: boolean;
  readonly owner: MemberRow | undefined;
  readonly brandColor: BrandColor | undefined;
  readonly onFocus: () => void;
  readonly onPeek: () => void;
  readonly onTogglePeek: () => void;
  readonly onOpenActive: () => void;
  readonly onToggleSelected: () => void;
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isUnmodified(event: KeyboardEvent<HTMLElement>): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.repeat);
}

function keyHandler(bindings: Readonly<Record<string, () => void>>) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || !isUnmodified(event)) return;
    const run = bindings[event.key];
    if (run === undefined) return;
    event.preventDefault();
    run();
  };
}

function swallowSpaceRelease(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === ' ') event.preventDefault();
}

function RowOwner({ owner }: { readonly owner: MemberRow | undefined }) {
  if (owner === undefined) {
    return (
      <span
        role="img"
        aria-label="Unassigned"
        className="size-4.5 shrink-0 rounded-full border border-border border-dashed"
      />
    );
  }
  return <Avatar name={owner.name} src={owner.image} size="xs" />;
}

export function LeadRowView({
  lead,
  active,
  selected,
  owner,
  brandColor,
  onFocus,
  onPeek,
  onTogglePeek,
  onOpenActive,
  onToggleSelected,
}: LeadRowViewProps) {
  const focusByUser = (event: FocusEvent<HTMLElement>) => {
    if (!isWindowRefocus(event)) onFocus();
  };
  const linkKeys = keyHandler({ ' ': onTogglePeek });
  const checkboxKeys = keyHandler({ ' ': onTogglePeek, Enter: onOpenActive });
  return (
    <div
      id={`lead-${lead.id}`}
      data-testid={`lead-row-${lead.key}`}
      data-active={active ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group flex h-7 w-full items-center gap-2 px-3 text-dense',
        listRowHover,
        active && 'bg-surface-2 hover:bg-surface-2',
        selected && 'bg-accent-soft hover:bg-accent-soft',
      )}
    >
      <span className="flex size-4 items-center justify-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          onFocus={focusByUser}
          onPointerDown={onFocus}
          onKeyDown={checkboxKeys}
          onKeyUp={swallowSpaceRelease}
          tabIndex={-1}
          aria-label={`Select ${lead.key}`}
          className={cn(revealOnHover, (active || selected) && 'opacity-100')}
        />
      </span>
      <PriorityGlyph priority={lead.priority} />
      <span
        data-numeric
        className="w-16 shrink-0 truncate whitespace-nowrap text-2xs text-faint"
        title={lead.key}
      >
        {lead.key}
      </span>
      {brandColor === undefined ? null : <BrandDot color={brandColor} />}
      <Link
        href={personHref(lead)}
        prefetch={false}
        onFocus={focusByUser}
        onKeyDown={linkKeys}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          if (event.detail === 0) {
            onOpenActive();
            return;
          }
          onFocus();
          onPeek();
        }}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded-sm text-text"
      >
        <span className="truncate">{lead.personName}</span>
        {lead.companyName === null ? null : (
          <span className="truncate text-muted">{lead.companyName}</span>
        )}
      </Link>
      {lead.nextAction === null ? null : (
        <span className="hidden max-w-56 truncate text-muted md:block">
          {lead.nextAction}
          {lead.nextActionAt === null ? null : (
            <span data-numeric className="ml-1 text-2xs text-faint">
              <RelativeTime at={lead.nextActionAt} />
            </span>
          )}
        </span>
      )}
      <OwedByChip owedBy={lead.owedBy} />
      <span
        data-numeric
        className="hidden w-16 shrink-0 text-right text-2xs text-faint lg:block"
        title="Last outreach"
      >
        {lead.lastOutboundAt === null ? null : <RelativeTime at={lead.lastOutboundAt} />}
      </span>
      <RowOwner owner={owner} />
    </div>
  );
}
