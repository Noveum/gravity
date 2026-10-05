"use client";
import { useEffect } from "react";
import { useCrm } from "./crm-context";

export function useRevealedRecord() {
  const { focusedRecord } = useCrm();
  useEffect(() => {
    if (!focusedRecord) return;
    const target = document.querySelector<HTMLElement>(
      `[data-record-id="${focusedRecord}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
  }, [focusedRecord]);
  return focusedRecord;
}
