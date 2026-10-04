'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { COPY_FOR_AGENT_BINDING, useCopyForAgent } from '@/lib/copy-for-agent.tsx';
import { navRowHover } from '@/lib/interaction.ts';
import { formatBinding } from '@/lib/keyboard/index.ts';

export function RecordMenu({ name }: { readonly name: string }) {
  const copyForAgent = useCopyForAgent();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More actions for ${name}`}
        className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint ${navRowHover}`}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => copyForAgent()}>
          Copy for agent
          <DropdownMenuShortcut>
            <Kbd keys={formatBinding(COPY_FOR_AGENT_BINDING)} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
