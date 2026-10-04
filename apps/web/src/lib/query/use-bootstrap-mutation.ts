'use client';

import type { SyncModel } from '@gravity/shared/events';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { noteServerRow } from '@/lib/realtime/delta-bridge.tsx';
import { patchBootstrap } from './bootstrap-cache.ts';
import { isRefusal } from './fetcher.ts';
import { BOOTSTRAP_ROOT, queryKeys } from './keys.ts';
import { cancelLoadedQueries } from './pages.ts';
import type { Bootstrap } from './schemas.ts';
import { useRetryToast } from './use-retry-toast.ts';

export interface ServedRow {
  readonly model: SyncModel;
  readonly id: string;
  readonly syncId: number;
}

export interface BootstrapMutationOptions<TInput, TResult> {
  readonly mutationFn: (input: TInput) => Promise<TResult>;
  readonly optimistic?: (bootstrap: Bootstrap, input: TInput) => Bootstrap;
  readonly settle: (bootstrap: Bootstrap, result: TResult) => Bootstrap;
  readonly served?: (result: TResult) => readonly ServedRow[];
  readonly failure: (input: TInput) => string;
  readonly onRefused?: (input: TInput, message: string) => boolean;
  readonly afterSuccess?: (result: TResult, input: TInput) => void;
  readonly scope?: { readonly id: string };
}

interface BootstrapMutationContext {
  readonly previous: Bootstrap | undefined;
}

export function useBootstrapMutation<TInput, TResult>(
  options: BootstrapMutationOptions<TInput, TResult>,
) {
  const client = useQueryClient();
  const failed = useRetryToast();
  const mutation = useMutation<TResult, Error, TInput, BootstrapMutationContext>({
    mutationFn: options.mutationFn,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    onMutate: async (input) => {
      await cancelLoadedQueries(client, BOOTSTRAP_ROOT);
      const previous = client.getQueryData<Bootstrap>(queryKeys.bootstrap);
      const optimistic = options.optimistic;
      if (optimistic !== undefined)
        patchBootstrap(client, (bootstrap) => optimistic(bootstrap, input));
      return { previous };
    },
    onError: (error, input, context) => {
      if (context?.previous !== undefined)
        client.setQueryData(queryKeys.bootstrap, context.previous);
      client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(() => undefined);
      if (isRefusal(error) && options.onRefused?.(input, error.message) === true) return;
      failed(options.failure(input), error, () => mutation.mutate(input));
    },
    onSuccess: (result, input) => {
      for (const row of options.served?.(result) ?? []) {
        noteServerRow(client, row.model, row.id, row.syncId);
      }
      patchBootstrap(client, (bootstrap) => options.settle(bootstrap, result));
      options.afterSuccess?.(result, input);
    },
  });
  return mutation;
}
