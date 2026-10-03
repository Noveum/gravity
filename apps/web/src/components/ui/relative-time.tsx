'use client';

import { relativeTime } from '@gravity/shared/utils';

export interface RelativeTimeProps {
  readonly at: string;
}

export function RelativeTime({ at }: RelativeTimeProps) {
  return (
    <time dateTime={at} suppressHydrationWarning>
      {relativeTime(new Date(at))}
    </time>
  );
}
