'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/cn.ts';

export interface CollapsibleProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Collapsible({ open, children, className }: CollapsibleProps) {
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-state={visible ? 'open' : 'closed'}
      className={cn(
        'transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out-gravity)] motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
