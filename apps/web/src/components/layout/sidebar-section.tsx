'use client';

import { ChevronRight } from 'lucide-react';
import { Children, type ReactNode, useState } from 'react';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';

export interface SidebarSectionProps {
  readonly title: string;
  readonly children?: ReactNode;
}

export function SidebarSection({ title, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(true);

  if (Children.toArray(children).length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-1 rounded-md px-2 pt-1 pb-1',
          'font-medium text-2xs text-faint uppercase tracking-wide',
          tabHover,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-faint transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      <Collapsible open={open} className="flex flex-col gap-0.5">
        {children}
      </Collapsible>
    </div>
  );
}
