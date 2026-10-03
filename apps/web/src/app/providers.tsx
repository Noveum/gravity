'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { QueryProvider } from '@/lib/query/provider.tsx';

export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <TooltipProvider>
          <ToastProvider>
            <HotkeyProvider>{children}</HotkeyProvider>
          </ToastProvider>
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
