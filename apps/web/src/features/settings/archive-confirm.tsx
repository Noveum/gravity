'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button.tsx';

export function ArchiveConfirm({
  title,
  children,
  onConfirm,
  onCancel,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const messageId = useId();
  const keep = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    keep.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label={title}
      aria-describedby={messageId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      className="flex flex-wrap items-center gap-2 rounded-md border border-danger p-2 text-dense"
    >
      <span id={messageId} className="min-w-0 flex-1 text-danger">
        {children}
      </span>
      <Button size="sm" variant="danger" onClick={onConfirm}>
        Archive
      </Button>
      <Button ref={keep} size="sm" variant="ghost" onClick={onCancel}>
        Keep
      </Button>
    </div>
  );
}
