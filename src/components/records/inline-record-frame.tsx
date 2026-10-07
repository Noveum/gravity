"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function InlineRecordFrame({
  titleId,
  loading,
  busy = false,
  children,
}: {
  titleId: string;
  loading: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!loading)
      frame.current
        ?.querySelector<HTMLElement>("[data-primary-field]:not(:disabled)")
        ?.focus();
  }, [loading]);
  return (
    <section
      ref={frame}
      data-record-editor
      data-dirty={dirty || busy || undefined}
      onChange={() => setDirty(true)}
      className="inline-record-editor"
      aria-labelledby={titleId}
    >
      {children}
    </section>
  );
}
