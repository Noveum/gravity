"use client";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";

export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  name,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        ref={setTrigger}
        className="select-trigger"
        aria-label={label}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={14} aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal
        container={trigger?.closest<HTMLElement>(
          "dialog[open], [aria-modal=true]",
        )}
      >
        <SelectPrimitive.Content
          className="select-popup"
          position="popper"
          sideOffset={4}
          collisionPadding={8}
        >
          <SelectPrimitive.Viewport className="select-options">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="select-option"
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
