"use client";
import t from "@crm/i18n/translations/en.json";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, X } from "lucide-react";
import { type ReactNode, useState } from "react";

export function FilterPopover({
  label,
  summary = label,
  active = false,
  children,
}: {
  label: string;
  summary?: string;
  active?: boolean;
  children: ReactNode;
}) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <Popover.Root>
      <Popover.Trigger
        ref={setTrigger}
        className="filter-chip"
        data-active={active || undefined}
        aria-label={label}
        title={summary}
      >
        <span>{summary}</span>
        <ChevronDown size={12} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal
        container={trigger?.closest<HTMLElement>(
          "dialog[open], [aria-modal=true]",
        )}
      >
        <Popover.Content
          className="filter-popup"
          aria-label={label}
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <div className="filter-popup-heading">
            <strong>{label}</strong>
            <Popover.Close className="icon-button" aria-label={t.close}>
              <X size={14} aria-hidden />
            </Popover.Close>
          </div>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
