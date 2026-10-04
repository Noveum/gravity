'use client';

import { ACTIVITY_ENTITY_TYPES } from '@gravity/shared/constants';
import { useCallback } from 'react';
import { z } from 'zod';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';

export const COPY_FOR_AGENT_BINDING = 'mod+shift+a';

const FAILURE_TITLE = 'Could not copy the context';

const contextResponseSchema = z.object({
  subject: z.object({ type: z.enum(ACTIVITY_ENTITY_TYPES), id: z.string() }),
  text: z.string(),
});

function clipboardFailure(): string {
  return window.isSecureContext
    ? 'The browser blocked clipboard access.'
    : 'Copying needs a secure connection, open Gravity over https.';
}

export function useCopyForAgent(ref: string): void {
  const { toast } = useToast();
  const copy = useCallback(async () => {
    let text: string;
    try {
      const context = await apiFetch(
        `/api/context?ref=${encodeURIComponent(ref)}`,
        contextResponseSchema,
      );
      text = context.text;
    } catch (error: unknown) {
      toast({
        title: FAILURE_TITLE,
        description: messageOf(error, 'The context could not be loaded.'),
        tone: 'danger',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast({ title: FAILURE_TITLE, description: clipboardFailure(), tone: 'danger' });
      return;
    }
    toast({ title: 'Context copied', description: 'Paste it into your agent chat.' });
  }, [ref, toast]);
  useHotkey(
    COPY_FOR_AGENT_BINDING,
    () => {
      copy().catch(() => undefined);
    },
    { label: 'Copy this record for an agent', section: 'Records' },
  );
}
