'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { describeFailure } from '@/features/workspace/role-hint.ts';
import { isRetryable } from './fetcher.ts';

export type RetryToast = (title: string, error: unknown, retry: () => void) => void;

export function useRetryToast(): RetryToast {
  const { toast } = useToast();
  return useCallback<RetryToast>(
    (title, error, retry) =>
      toast({
        title,
        description: describeFailure(error),
        tone: 'danger',
        ...(isRetryable(error) ? { action: { label: 'Retry', onSelect: retry } } : {}),
      }),
    [toast],
  );
}
