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
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';

export const COPY_LINK_BINDING = 'mod+shift+c';

interface CopyLinkApi {
  readonly setTarget: (path: string | null) => void;
  readonly copy: () => void;
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
  const copyNow = useCallback(() => {
    copy().catch(() => undefined);
  }, [copy]);
  useHotkey(COPY_LINK_BINDING, copyNow, {
    label: 'Copy link to this record or view',
    section: 'General',
    priority: HOTKEY_PRIORITY.surface,
    allowInInput: true,
  });
  const api = useMemo<CopyLinkApi>(
    () => ({
      setTarget: (path) => {
        target.current = path;
      },
      copy: copyNow,
    }),
    [copyNow],
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

export function useCopyLink(): () => void {
  const api = useContext(CopyLinkContext);
  if (api === null) throw new Error('useCopyLink must be used inside CopyLinkProvider');
  return api.copy;
}
