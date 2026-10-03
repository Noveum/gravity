'use client';

import { Command, defaultFilter } from 'cmdk';
import { type ComponentProps, type ReactNode, useMemo } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover.tsx';

export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: ReactNode;
}

export interface VerbPickerProps {
  readonly open: boolean;
  readonly anchorId: string | null;
  readonly title: string;
  readonly options: readonly PickerOption[];
  readonly notice?: string | null;
  readonly onPick: (id: string) => void;
  readonly onClose: () => void;
  readonly returnFocus?: FocusTarget;
}

export const pickerItemClassName =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-dense text-muted outline-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-text';

const FOCUSABLE = 'a[href], button:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

function viewportFallback(): DOMRect {
  return new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
}

export type AnchorRef = NonNullable<ComponentProps<typeof PopoverAnchor>['virtualRef']>;

export function useAnchor(anchorId: string | null): AnchorRef {
  return useMemo(() => {
    let last: DOMRect | null = null;
    const element = () => (anchorId === null ? null : document.getElementById(anchorId));
    const anchor = {
      getBoundingClientRect: (): DOMRect => {
        const rect = element()?.getBoundingClientRect();
        if (rect !== undefined) last = rect;
        return last ?? viewportFallback();
      },
      get contextElement(): Element | undefined {
        return element() ?? undefined;
      },
    };
    return { current: anchor };
  }, [anchorId]);
}

export function anchorFocusTarget(anchorId: string | null): HTMLElement | null {
  const anchor = anchorId === null ? null : document.getElementById(anchorId);
  if (anchor === null) return null;
  return anchor.matches(FOCUSABLE) ? anchor : anchor.querySelector<HTMLElement>(FOCUSABLE);
}

function focusLandedElsewhere(): boolean {
  const current = document.activeElement;
  return current !== null && current !== document.body && current.isConnected;
}

export type FocusTarget = () => HTMLElement | null;

export function focusBack(target: FocusTarget): (event: Event) => void {
  return (event) => {
    event.preventDefault();
    if (focusLandedElsewhere()) return;
    target()?.focus({ preventScroll: true });
  };
}

export function labelFilter(_value: string, search: string, keywords?: string[]): number {
  return defaultFilter(keywords?.join(' ') ?? '', search);
}

export function VerbPicker({
  open,
  anchorId,
  title,
  options,
  notice = null,
  onPick,
  onClose,
  returnFocus = () => anchorFocusTarget(anchorId),
}: VerbPickerProps) {
  const anchor = useAnchor(anchorId);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (open && !next) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        className="w-72 p-0"
        aria-label={title}
        onCloseAutoFocus={focusBack(returnFocus)}
      >
        <Command loop label={title} filter={labelFilter}>
          <Command.Input
            placeholder={title}
            className="h-9 w-full border-border border-b bg-transparent px-3 text-dense text-text outline-none placeholder:text-faint"
          />
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-3 text-center text-dense text-muted">
              Nothing matches that.
            </Command.Empty>
            {options.map((option) => (
              <Command.Item
                key={option.id}
                value={option.id}
                keywords={[option.label, option.hint ?? '']}
                onSelect={() => onPick(option.id)}
                className={pickerItemClassName}
              >
                {option.icon === undefined ? null : (
                  <span aria-hidden="true" className="flex shrink-0">
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint === undefined ? null : (
                  <span className="text-2xs text-faint">{option.hint}</span>
                )}
              </Command.Item>
            ))}
          </Command.List>
          {notice === null ? null : (
            <p className="border-border border-t px-3 py-2 text-warning text-xs">{notice}</p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
