"use client";
import { useCallback, useSyncExternalStore } from "react";

interface FilterScope {
  userId: string;
  organizationId: string;
}

const changeEvent = "gravity-filter-visibility";
const unsaved = new Map<string, boolean>();

export function filterVisibilityKey({ userId, organizationId }: FilterScope) {
  return `gravity-filter-visibility/${encodeURIComponent(userId)}/${encodeURIComponent(organizationId)}`;
}

function read(key: string) {
  const pending = unsaved.get(key);
  if (pending !== undefined) return pending;
  try {
    return localStorage.getItem(key) !== "hidden";
  } catch {
    return true;
  }
}

function write(key: string, visible: boolean) {
  try {
    localStorage.setItem(key, visible ? "visible" : "hidden");
    unsaved.delete(key);
  } catch {
    unsaved.set(key, visible);
  }
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: key }));
}

function subscribe(key: string, onChange: () => void) {
  const changed = (event: Event) => {
    if ((event as CustomEvent<string>).detail === key) onChange();
  };
  const stored = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return;
    unsaved.delete(key);
    onChange();
  };
  window.addEventListener(changeEvent, changed);
  window.addEventListener("storage", stored);
  return () => {
    window.removeEventListener(changeEvent, changed);
    window.removeEventListener("storage", stored);
  };
}

/** Filters start visible; only an explicit choice changes this scoped preference. */
export function useFilterVisibility(scope: FilterScope) {
  const key = filterVisibilityKey(scope);
  const listen = useCallback(
    (onChange: () => void) => subscribe(key, onChange),
    [key],
  );
  const snapshot = useCallback(() => read(key), [key]);
  const visible = useSyncExternalStore(listen, snapshot, () => true);
  const setVisible = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      write(key, typeof next === "function" ? next(read(key)) : next);
    },
    [key],
  );
  return { visible, setVisible };
}
