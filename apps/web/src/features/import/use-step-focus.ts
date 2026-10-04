'use client';

import { useEffect, useRef } from 'react';

export function useStepFocus(signal: object) {
  const target = useRef<HTMLHeadingElement | null>(null);
  const seen = useRef<object | null>(null);
  useEffect(() => {
    const previous = seen.current;
    seen.current = signal;
    if (previous !== null && previous !== signal) target.current?.focus();
  }, [signal]);
  return target;
}
