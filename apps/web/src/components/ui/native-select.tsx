'use client';

import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';

export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly ref?: Ref<HTMLSelectElement>;
}

export function NativeSelect({ className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        'h-9 rounded-md border border-border bg-surface px-2 text-dense text-text',
        'not-disabled:hover:border-border-strong focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
