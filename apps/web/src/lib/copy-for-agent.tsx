'use client';

import { ACTIVITY_ENTITY_TYPES } from '@gravity/shared/constants';
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
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';

export const COPY_FOR_AGENT_BINDING = 'mod+shift+a';

const FAILURE_TITLE = 'Could not copy the context';

const contextResponseSchema = z.object({
  subject: z.object({ type: z.enum(ACTIVITY_ENTITY_TYPES), id: z.string() }),
  label: z.string(),
  text: z.string(),
});
type ContextReply = z.infer<typeof contextResponseSchema>;

interface CopyApi {
  readonly copy: (target?: string) => void;
}

interface TargetApi {
  readonly claim: (ref: string) => void;
  readonly release: (ref: string) => void;
}

const CopyContext = createContext<CopyApi | null>(null);
const TargetContext = createContext<TargetApi | null>(null);

function loadContext(ref: string): Promise<ContextReply> {
  return apiFetch(`/api/context?ref=${encodeURIComponent(ref)}`, contextResponseSchema);
}

function startWrite(pending: Promise<ContextReply>): Promise<void> {
  try {
    if (typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function') {
      const blob = pending.then((reply) => new Blob([reply.text], { type: 'text/plain' }));
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    }
    return pending.then((reply) => navigator.clipboard.writeText(reply.text));
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}

function clipboardFailure(): string {
  return window.isSecureContext
    ? 'The browser blocked clipboard access.'
    : 'Copying needs a secure connection, open Gravity over https.';
}

export function CopyForAgentProvider({ children }: { readonly children: ReactNode }) {
  const { toast } = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const busy = useRef(false);

  const copy = useCallback(
    (explicit?: string) => {
      const ref = explicit ?? target;
      if (ref === null) {
        toast({
          title: 'Focus a record first',
          description: 'Open or select a lead, person or company, then copy it for an agent.',
        });
        return;
      }
      if (busy.current) return;
      busy.current = true;
      const pending = loadContext(ref);
      const written = startWrite(pending);
      Promise.allSettled([pending, written])
        .then(([loaded, wrote]) => {
          if (loaded.status === 'rejected') {
            toast({
              title: FAILURE_TITLE,
              description: messageOf(loaded.reason, 'The context could not be loaded.'),
              tone: 'danger',
            });
          } else if (wrote.status === 'rejected') {
            toast({ title: FAILURE_TITLE, description: clipboardFailure(), tone: 'danger' });
          } else {
            toast({
              title: `Copied ${loaded.value.label}`,
              description: 'Paste it into your agent chat.',
            });
          }
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [target, toast],
  );

  useHotkey(COPY_FOR_AGENT_BINDING, () => copy(), {
    label: 'Copy this record for an agent',
    section: 'Records',
    priority: HOTKEY_PRIORITY.surface,
    allowInInput: true,
    enabled: target !== null,
  });

  const copyApi = useMemo<CopyApi>(() => ({ copy }), [copy]);
  const targetApi = useMemo<TargetApi>(
    () => ({
      claim: (ref) => setTarget(ref),
      release: (ref) => setTarget((current) => (current === ref ? null : current)),
    }),
    [],
  );

  return (
    <TargetContext.Provider value={targetApi}>
      <CopyContext.Provider value={copyApi}>{children}</CopyContext.Provider>
    </TargetContext.Provider>
  );
}

export function useCopyForAgentTarget(ref: string | null): void {
  const api = useContext(TargetContext);
  useEffect(() => {
    if (api === null || ref === null) return undefined;
    api.claim(ref);
    return () => api.release(ref);
  }, [api, ref]);
}

export function useCopyForAgent(): (target?: string) => void {
  const api = useContext(CopyContext);
  if (api === null) throw new Error('useCopyForAgent must be used inside CopyForAgentProvider');
  return api.copy;
}
