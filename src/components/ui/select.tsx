"use client";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { type ComponentProps, useState } from "react";

export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  name,
  id,
  title,
  className = "",
  displayValue,
  "aria-keyshortcuts": keyshortcuts,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  title?: string;
  className?: string;
  displayValue?: string;
  "aria-keyshortcuts"?: ComponentProps<"button">["aria-keyshortcuts"];
}) {
  const visibleOptions =
    value && !options.some((option) => option.value === value)
      ? [{ value, label: value.replaceAll("_", " ") }, ...options]
      : options;
  let emptyValue = "__gravity_all__";
  while (visibleOptions.some((option) => option.value === emptyValue))
    emptyValue += "_";
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <SelectPrimitive.Root
      value={value || emptyValue}
      onValueChange={(next) => onChange(next === emptyValue ? "" : next)}
      disabled={disabled}
    >
      {name && (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      )}
      <SelectPrimitive.Trigger
        ref={setTrigger}
        id={id}
        className={`select-trigger ${className}`}
        aria-label={label}
        aria-keyshortcuts={keyshortcuts}
        title={
          title ??
          visibleOptions.find((option) => option.value === value)?.label
        }
      >
        <SelectPrimitive.Value>{displayValue}</SelectPrimitive.Value>
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
            {visibleOptions.map((option) => (
              <SelectPrimitive.Item
                className="select-option"
                key={option.value}
                value={option.value || emptyValue}
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
