'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

const OPEN_AT_ANY_WIDTH = '/settings/members';

export function SettingsContent({ children }: { readonly children: ReactNode }) {
  const wideOnly = !usePathname().startsWith(OPEN_AT_ANY_WIDTH);
  return (
    <div className="min-w-0 flex-1 min-[900px]:overflow-y-auto">
      {wideOnly ? (
        <p className="p-4 text-muted text-dense min-[900px]:hidden">
          This page is available on screens 900 pixels wide and larger.
        </p>
      ) : null}
      <div className={cn(wideOnly && 'hidden min-[900px]:block')}>{children}</div>
    </div>
  );
}
