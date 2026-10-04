import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { CopyForAgentProvider } from '@/lib/copy-for-agent.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Bootstrap } from '@/lib/query/schemas.ts';
import { bootstrapFixture } from './bootstrap-fixture.ts';

export interface RenderOptions {
  readonly bootstrap?: Bootstrap | null;
  readonly client?: QueryClient;
}

export function renderWithClient(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult & { client: QueryClient } {
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
  if (options.bootstrap !== null) {
    client.setQueryData(queryKeys.bootstrap, options.bootstrap ?? bootstrapFixture());
  }
  const result = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>
            <CopyForAgentProvider>{ui}</CopyForAgentProvider>
          </HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
