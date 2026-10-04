'use client';

import { CircleAlert } from 'lucide-react';
import { describeFailure } from '@/features/workspace/role-hint.ts';
import { Button } from './button.tsx';
import { EmptyState } from './empty-state.tsx';

export interface ErrorStateProps {
  readonly title: string;
  readonly error: unknown;
  readonly onRetry?: () => void;
}

export function ErrorState({ title, error, onRetry }: ErrorStateProps) {
  const description = describeFailure(
    error,
    'The request did not complete. Check your connection and retry.',
  );
  return (
    <EmptyState
      icon={<CircleAlert />}
      title={title}
      description={description}
      action={
        onRetry === undefined ? undefined : (
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}
