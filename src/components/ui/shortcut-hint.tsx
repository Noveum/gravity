"use client";
import { bindingLabel, type ShortcutId, shortcut } from "@crm/core/shortcuts";
import { useEffect, useState } from "react";
import { macPlatform } from "../shortcuts";

export function ShortcutHint({
  id,
  className = "",
  decorative = true,
}: {
  id: ShortcutId;
  className?: string;
  decorative?: boolean;
}) {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(macPlatform());
  }, []);
  const binding = shortcut(id).bindings[0];
  if (!binding) return null;
  return (
    <span
      className={`shortcut-hint ${className}`}
      aria-hidden={decorative || undefined}
    >
      <kbd>{bindingLabel(binding, mac)}</kbd>
    </span>
  );
}
