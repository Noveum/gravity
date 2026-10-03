'use client';

import { relativeTime } from '@gravity/shared/utils';
import { useSyncExternalStore } from 'react';

export interface RelativeTimeProps {
  readonly at: string;
}

function subscribe(): () => void {
  return () => undefined;
}

function onClient(): boolean {
  return true;
}

function onServer(): boolean {
  return false;
}

export function RelativeTime({ at }: RelativeTimeProps) {
  const client = useSyncExternalStore(subscribe, onClient, onServer);
  return (
    <time key={client ? 'client' : 'server'} dateTime={at} suppressHydrationWarning>
      {relativeTime(new Date(at))}
    </time>
  );
}
