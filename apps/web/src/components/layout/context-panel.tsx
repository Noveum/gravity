'use client';

import { usePathname } from 'next/navigation';
import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/cn.ts';
import {
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  useContextPanel,
} from '@/lib/context-panel.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { isRecordPath } from '@/lib/navigation.ts';
import { useMediaQuery } from '@/lib/use-media-query.ts';

const PUSH_QUERY = '(min-width: 1200px)';
const OVERLAY_QUERY = '(min-width: 900px)';
const KEYBOARD_STEP = 16;
const KEYBOARD_TARGET: Readonly<Record<string, (width: number) => number>> = {
  ArrowLeft: (width) => width + KEYBOARD_STEP,
  ArrowRight: (width) => width - KEYBOARD_STEP,
  Home: () => CONTEXT_PANEL_MIN_WIDTH,
  End: () => CONTEXT_PANEL_MAX_WIDTH,
};

function WidthHandle() {
  const { width, resize, commit } = useContextPanel();
  const drag = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== null) resize(drag.current.width + drag.current.x - event.clientX);
  };
  const onPointerUp = () => {
    if (drag.current === null) return;
    drag.current = null;
    commit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = KEYBOARD_TARGET[event.key]?.(width);
    if (next === undefined) return;
    event.preventDefault();
    resize(next);
    commit();
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Context panel width"
      aria-orientation="horizontal"
      aria-valuemin={CONTEXT_PANEL_MIN_WIDTH}
      aria-valuemax={CONTEXT_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none outline-none hover:bg-accent focus-visible:bg-accent"
    />
  );
}

export function ContextPanel() {
  const panel = useContextPanel();
  const pathname = usePathname();
  const pushes = useMediaQuery(PUSH_QUERY, true);
  const overlays = useMediaQuery(OVERLAY_QUERY, true);
  useHotkey(']', panel.toggle, {
    label: 'Show or hide the context panel',
    section: 'View',
    enabled: !isRecordPath(pathname),
  });

  if (!panel.open || panel.content === null) return null;

  if (!overlays) {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) panel.hide();
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">{panel.label}</DialogTitle>
          {panel.content}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <aside
      aria-label={panel.label}
      style={{ width: panel.width }}
      className={cn(
        'relative h-full shrink-0 border-border border-l bg-surface',
        'data-[state=open]:animate-panel-in motion-reduce:animate-none',
        pushes ? null : 'absolute inset-y-0 right-0 z-30 shadow-pop',
      )}
      data-state="open"
    >
      <WidthHandle />
      <div className="h-full overflow-y-auto">{panel.content}</div>
    </aside>
  );
}
