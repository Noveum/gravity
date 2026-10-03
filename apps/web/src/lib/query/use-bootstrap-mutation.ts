'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patchBootstrap } from './bootstrap-cache.ts';
import { BOOTSTRAP_ROOT, queryKeys } from './keys.ts';
import { cancelLoadedQueries } from './pages.ts';
import type { Bootstrap } from './schemas.ts';
import { useRetryToast } from './use-retry-toast.ts';

export interface BootstrapMutationOptions<TInput, TResult> {
  readonly mutationFn: (input: TInput) => Promise<TResult>;
  readonly optimistic?: (bootstrap: Bootstrap, input: TInput) => Bootstrap;
  readonly settle: (bootstrap: Bootstrap, result: TResult) => Bootstrap;
  readonly failure: (input: TInput) => string;
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
      failed(options.failure(input), error, () => mutation.mutate(input));
    },
    onSuccess: (result) => patchBootstrap(client, (bootstrap) => options.settle(bootstrap, result)),
  });
  return mutation;
}
