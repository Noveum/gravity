'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';

interface CopyLinkApi {
  readonly setTarget: (path: string | null) => void;
}

const CopyLinkContext = createContext<CopyLinkApi | null>(null);

export function CopyLinkProvider({ children }: { readonly children: ReactNode }) {
  const target = useRef<string | null>(null);
  const { toast } = useToast();
  const copy = useCallback(async () => {
    const url =
      target.current === null
        ? window.location.href
        : new URL(target.current, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', description: url });
    } catch {
      toast({
        title: 'Could not copy the link',
        description: 'The browser blocked clipboard access.',
        tone: 'danger',
      });
    }
  }, [toast]);
  useHotkey(
    'mod+shift+c',
    () => {
      copy().catch(() => undefined);
    },
    { label: 'Copy link to this record or view', section: 'General', allowInInput: true },
  );
  const api = useMemo<CopyLinkApi>(
    () => ({
      setTarget: (path) => {
        target.current = path;
      },
    }),
    [],
  );
  return <CopyLinkContext.Provider value={api}>{children}</CopyLinkContext.Provider>;
}

export function useCopyLinkTarget(path: string | null): void {
  const api = useContext(CopyLinkContext);
  useEffect(() => {
    api?.setTarget(path);
    return () => api?.setTarget(null);
  }, [api, path]);
}
