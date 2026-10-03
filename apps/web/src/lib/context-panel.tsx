'use client';

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import { patchBootstrap } from '@/lib/query/bootstrap-cache.ts';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { preferenceEnvelopeSchema } from '@/lib/query/schemas.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';

export const CONTEXT_PANEL_MIN_WIDTH = 360;
export const CONTEXT_PANEL_MAX_WIDTH = 640;
export const CONTEXT_PANEL_DEFAULT_WIDTH = 420;
const PREFERENCE_PAGE = 'context-panel';

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return CONTEXT_PANEL_DEFAULT_WIDTH;
  return Math.round(Math.min(CONTEXT_PANEL_MAX_WIDTH, Math.max(CONTEXT_PANEL_MIN_WIDTH, width)));
}

const preferenceSchema = z
  .object({ width: z.number().optional(), open: z.boolean().optional() })
  .catch({});

export const PREFERENCE_DEBOUNCE_MS = 300;

interface PanelDisplay {
  readonly width: number;
  readonly open: boolean;
}

function useDebouncedPreference(client: QueryClient): (display: PanelDisplay) => void {
  const pending = useRef<PanelDisplay | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const flush = useCallback(() => {
    timer.current = null;
    const display = pending.current;
    if (display === null || inFlight.current) return;
    pending.current = null;
    inFlight.current = true;
    apiFetch('/api/view-preferences', preferenceEnvelopeSchema, {
      method: 'PUT',
      body: { page: PREFERENCE_PAGE, display },
    })
      .then(({ preference }) => {
        if (pending.current !== null) return;
        patchBootstrap(client, (bootstrap) => ({
          ...bootstrap,
          viewPreferences: [
            ...bootstrap.viewPreferences.filter((entry) => entry.page !== PREFERENCE_PAGE),
            preference,
          ],
        }));
      })
      .catch((error: unknown) =>
        console.warn('Could not remember the context panel layout.', error),
      )
      .finally(() => {
        inFlight.current = false;
        if (pending.current !== null && timer.current === null) flush();
      });
  }, [client]);

  useEffect(() => {
    const flushNow = () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      flush();
    };
    window.addEventListener('pagehide', flushNow);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      flushNow();
    };
  }, [flush]);

  return useCallback(
    (display: PanelDisplay) => {
      pending.current = display;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, PREFERENCE_DEBOUNCE_MS);
    },
    [flush],
  );
}

export interface ContextPanelApi {
  readonly open: boolean;
  readonly width: number;
  readonly content: ReactNode;
  readonly label: string;
  readonly show: (content: ReactNode, label: string) => void;
  readonly hide: () => void;
  readonly toggle: () => void;
  readonly resize: (width: number) => void;
  readonly commit: () => void;
}

const ContextPanelContext = createContext<ContextPanelApi | null>(null);

export function useContextPanel(): ContextPanelApi {
  const api = useContext(ContextPanelContext);
  if (api === null) throw new Error('useContextPanel must be used inside ContextPanelProvider');
  return api;
}

export function ContextPanelProvider({ children }: { readonly children: ReactNode }) {
  const client = useQueryClient();
  const { data } = useBootstrap();
  const saved = preferenceSchema.parse(
    data?.viewPreferences.find((entry) => entry.page === PREFERENCE_PAGE)?.display ?? {},
  );
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [content, setContent] = useState<{ node: ReactNode; label: string } | null>(null);
  const width = clampPanelWidth(widthOverride ?? saved.width ?? CONTEXT_PANEL_DEFAULT_WIDTH);
  const open = openOverride ?? saved.open ?? true;
  const latest = useRef({ width, open, hasContent: content !== null });
  latest.current = { width, open, hasContent: content !== null };
  const persist = useDebouncedPreference(client);

  const show = useCallback((node: ReactNode, label: string) => {
    setContent({ node, label });
    setOpenOverride(true);
  }, []);
  const hide = useCallback(() => setOpenOverride(false), []);
  const toggle = useCallback(() => {
    if (!latest.current.hasContent) return;
    const next = !latest.current.open;
    setOpenOverride(next);
    persist({ width: latest.current.width, open: next });
  }, [persist]);
  const resize = useCallback((next: number) => {
    const clamped = clampPanelWidth(next);
    latest.current = { ...latest.current, width: clamped };
    setWidthOverride(clamped);
  }, []);
  const commit = useCallback(
    () => persist({ width: latest.current.width, open: latest.current.open }),
    [persist],
  );

  const api = useMemo<ContextPanelApi>(
    () => ({
      open,
      width,
      content: content?.node ?? null,
      label: content?.label ?? '',
      show,
      hide,
      toggle,
      resize,
      commit,
    }),
    [open, width, content, show, hide, toggle, resize, commit],
  );
  return <ContextPanelContext.Provider value={api}>{children}</ContextPanelContext.Provider>;
}
