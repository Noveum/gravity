'use client';

import { PERMISSIONS, type Permission } from '@gravity/shared/policy';
import { CircleAlert } from 'lucide-react';
import { minimumRoleFor } from '@/features/workspace/role-hint.ts';
import { ApiError, messageOf } from '@/lib/query/fetcher.ts';
import { Button } from './button.tsx';
import { EmptyState } from './empty-state.tsx';

export interface ErrorStateProps {
  readonly title: string;
  readonly error: unknown;
  readonly onRetry?: () => void;
}

function permissionOf(error: unknown): Permission | null {
  if (!(error instanceof ApiError) || error.code !== 'forbidden') return null;
  const permission = error.details?.['permission'];
  return PERMISSIONS.find((entry) => entry === permission) ?? null;
}

export function ErrorState({ title, error, onRetry }: ErrorStateProps) {
  const permission = permissionOf(error);
  const description =
    permission === null
      ? messageOf(error, 'The request did not complete. Check your connection and retry.')
      : `${messageOf(error)} Ask an admin for the ${minimumRoleFor(permission)} role.`;
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
