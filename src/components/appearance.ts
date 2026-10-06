"use client";
import { useSyncExternalStore } from "react";
import { darkQuery, densityKey, sidebarKey, themeKey } from "./appearance-boot";

export type ThemePreference = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

const changeEvent = "gravity-appearance";
const unsaved = new Map<string, string>();

function read(key: string) {
  const pending = unsaved.get(key);
  if (pending !== undefined) return pending;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, value);
  }
  window.dispatchEvent(new Event(changeEvent));
}
function systemDark() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(darkQuery).matches
  );
}

export function themePreference(): ThemePreference {
  const value = read(themeKey);
  return value === "light" || value === "dark" ? value : "system";
}
export function resolvedTheme(preference = themePreference()) {
  return preference === "system"
    ? systemDark()
      ? "dark"
      : "light"
    : preference;
}
export function density(): Density {
  return read(densityKey) === "comfortable" ? "comfortable" : "compact";
}
export function sidebarCollapsed() {
  return read(sidebarKey) === "collapsed";
}

function releaseAfterFrame(root: HTMLElement) {
  getComputedStyle(document.body ?? root).getPropertyValue("color");
  const release = () => root.removeAttribute("data-theme-switching");
  if (typeof window.requestAnimationFrame === "function")
    window.requestAnimationFrame(release);
  else window.setTimeout(release, 16);
}

export function applyAppearance() {
  const root = document.documentElement;
  const dark = resolvedTheme() === "dark";
  const switching = root.classList.contains("dark") !== dark;
  if (switching) root.setAttribute("data-theme-switching", "");
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  if (switching) releaseAfterFrame(root);
  root.dataset.density = density();
  root.dataset.sidebar = sidebarCollapsed() ? "collapsed" : "expanded";
}
export function setThemePreference(value: ThemePreference) {
  write(themeKey, value);
  applyAppearance();
}
export function toggleTheme() {
  setThemePreference(resolvedTheme() === "dark" ? "light" : "dark");
}
export function setDensity(value: Density) {
  write(densityKey, value);
  applyAppearance();
}
export function setSidebarCollapsed(value: boolean) {
  write(sidebarKey, value ? "collapsed" : "expanded");
  applyAppearance();
}

function subscribe(onChange: () => void) {
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia(darkQuery)
      : null;
  const sync = () => {
    applyAppearance();
    onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", sync);
  query?.addEventListener("change", sync);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", sync);
    query?.removeEventListener("change", sync);
  };
}
function snapshot() {
  const preference = themePreference();
  return `${preference}|${resolvedTheme(preference)}|${density()}|${sidebarCollapsed() ? "collapsed" : "expanded"}`;
}
const serverSnapshot = "system|light|compact|expanded";

export function useAppearance() {
  const [theme, resolved, rows, sidebar] = useSyncExternalStore(
    subscribe,
    snapshot,
    () => serverSnapshot,
  ).split("|");
  return {
    theme: theme as ThemePreference,
    resolved: resolved as "light" | "dark",
    density: rows as Density,
    sidebarCollapsed: sidebar === "collapsed",
  };
}
