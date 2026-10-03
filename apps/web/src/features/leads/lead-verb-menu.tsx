'use client';

import type { LeadRow } from '@gravity/shared/records';
import { MoreHorizontal } from 'lucide-react';
import { useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover } from '@/lib/interaction.ts';

export type VerbMode = 'stage' | 'owner' | 'priority' | 'nextAction' | 'hold' | 'close';

export interface VerbRequest {
  readonly lead: LeadRow;
  readonly verb: VerbMode;
  readonly origin: HTMLElement | null;
}

export const VERB_ITEMS: readonly {
  readonly verb: VerbMode;
  readonly label: string;
  readonly keys: string;
}[] = [
  { verb: 'stage', label: 'Set the stage', keys: 'S' },
  { verb: 'owner', label: 'Assign', keys: 'A' },
  { verb: 'priority', label: 'Set the priority', keys: 'P' },
  { verb: 'nextAction', label: 'Set the next action', keys: 'N' },
  { verb: 'hold', label: 'Hold with a reason', keys: 'Shift H' },
  { verb: 'close', label: 'Close', keys: 'Cmd Backspace' },
];

export interface LeadVerbMenuProps {
  readonly lead: LeadRow;
  readonly visible: boolean;
  readonly onVerb: (request: VerbRequest) => void;
  readonly verbs?: readonly VerbMode[];
}

export function LeadVerbMenu({ lead, visible, onVerb, verbs }: LeadVerbMenuProps) {
  const items =
    verbs === undefined ? VERB_ITEMS : VERB_ITEMS.filter((item) => verbs.includes(item.verb));
  const trigger = useRef<HTMLButtonElement | null>(null);
  const chosen = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        tabIndex={-1}
        aria-label={`More actions for ${lead.key}`}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-sm text-faint hover:bg-surface-2 hover:text-text',
          revealOnHover,
          visible && 'opacity-100',
        )}
      >
        <MoreHorizontal className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (chosen.current) event.preventDefault();
          chosen.current = false;
        }}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.verb}
            onSelect={() => {
              chosen.current = true;
              onVerb({ lead, verb: item.verb, origin: trigger.current });
            }}
          >
            {item.label}
            <DropdownMenuShortcut>{item.keys}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
