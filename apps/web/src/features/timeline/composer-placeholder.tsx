'use client';

import { useId, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea.tsx';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';

export function ComposerPlaceholder() {
  const id = useId();
  const box = useRef<HTMLTextAreaElement | null>(null);
  useHotkey('n', () => box.current?.focus(), {
    label: 'Add a note',
    section: 'Records',
    scope: 'records',
    priority: HOTKEY_PRIORITY.surface,
  });
  return (
    <div className="flex shrink-0 flex-col gap-1 border-border border-t p-3">
      <label htmlFor={id} className="text-faint text-xs">
        Note
      </label>
      <Textarea
        id={id}
        ref={box}
        readOnly
        rows={2}
        aria-describedby={`${id}-hint`}
        placeholder="Notes, calls and tasks arrive in the next milestone."
        className="resize-none"
      />
      <p id={`${id}-hint`} className="text-faint text-xs">
        Until then the timeline shows every change to this record and its leads.
      </p>
    </div>
  );
}
