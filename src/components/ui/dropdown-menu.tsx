"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { type ReactNode, useCallback, useState } from "react";

export function DropdownMenu({
  trigger,
  children,
  label,
  align = "start",
  side = "bottom",
  className = "",
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const focusCurrent = useCallback((node: HTMLDivElement | null) => {
    if (node)
      queueMicrotask(() => {
        if (node.isConnected)
          node.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
      });
  }, []);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild ref={setAnchor}>
        {trigger}
      </Menu.Trigger>
      <Menu.Portal
        container={anchor?.closest<HTMLElement>(
          "dialog[open], [aria-modal=true]",
        )}
      >
        <Menu.Content
          ref={focusCurrent}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className={`menu dropdown-popup ${className}`}
          aria-label={label}
          aria-labelledby={undefined}
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export const MenuItem = Menu.Item;
export const MenuRadioGroup = Menu.RadioGroup;
export const MenuRadioItem = Menu.RadioItem;
export const MenuSeparator = Menu.Separator;
export const MenuLabel = Menu.Label;
