'use client';

import { useEffect, useState } from 'react';

export const LOADING_DELAY_MS = 300;

export function useDelayedFlag(active: boolean, delayMs: number = LOADING_DELAY_MS): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && elapsed;
}
