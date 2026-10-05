"use client";
import { useEffect, useState } from "react";

/** Keep the server and first client render identical, then use platform keys. */
export function ShortcutHint({
  keys,
  className = "",
  decorative = true,
}: {
  keys: string;
  className?: string;
  decorative?: boolean;
}) {
  const [isMac, setIsMac] = useState<boolean | null>(null);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  if (!keys) return null;
  const display =
    isMac === null ? keys : keys.replace("⌘ / Ctrl", isMac ? "⌘" : "Ctrl");
  return (
    <span
      className={`shortcut-hint ${className}`}
      aria-hidden={decorative || undefined}
    >
      <kbd>{display}</kbd>
    </span>
  );
}
