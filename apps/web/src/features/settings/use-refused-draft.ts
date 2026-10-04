'use client';

import { useEffect, useRef, useState } from 'react';

export interface RefusedDraft<TInput> {
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
  readonly onRefused: (input: TInput, message: string) => boolean;
}

export function useRefusedDraft<TInput>(restore: (input: TInput) => void): RefusedDraft<TInput> {
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefused = (input: TInput, message: string): boolean => {
    if (!mounted.current) return false;
    restore(input);
    setError(message);
    return true;
  };

  return { error, setError, onRefused };
}
