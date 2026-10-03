'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from './fetcher.ts';

export type RetryToast = (title: string, error: unknown, retry: () => void) => void;

export function useRetryToast(): RetryToast {
  const { toast } = useToast();
  return useCallback<RetryToast>(
    (title, error, retry) =>
      toast({
        title,
        description: messageOf(error),
        tone: 'danger',
        action: { label: 'Retry', onSelect: retry },
      }),
    [toast],
  );
}
