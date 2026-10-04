'use client';

import { useEffect, useRef } from 'react';

export function useStepFocus(signal: object) {
  const target = useRef<HTMLHeadingElement | null>(null);
  const seen = useRef<object | null>(null);
  useEffect(() => {
    const first = seen.current === null;
    seen.current = signal;
    if (!first) target.current?.focus();
  }, [signal]);
  return target;
}
