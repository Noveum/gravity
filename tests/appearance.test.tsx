// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import {
  setSidebarCollapsed,
  useAppearance,
} from "../src/components/appearance";
import { ThemeToggle } from "../src/components/preferences";

function SidebarState() {
  const { sidebarCollapsed } = useAppearance();
  return <output>{sidebarCollapsed ? "collapsed" : "expanded"}</output>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the theme toggle and sidebar choice still work when browser storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(
    <>
      <ThemeToggle />
      <SidebarState />
    </>,
  );
  const toggle = screen.getByRole("button", { name: t.toggleTheme });
  fireEvent.click(toggle);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(toggle);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  act(() => setSidebarCollapsed(true));
  expect(screen.getByRole("status").textContent).toBe("collapsed");
  expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  vi.restoreAllMocks();
  fireEvent.click(toggle);
  act(() => setSidebarCollapsed(false));
  expect(localStorage.getItem("gravity-theme")).toBe("light");
  expect(localStorage.getItem("gravity-sidebar")).toBe("expanded");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

test("a theme change suppresses colour transitions for one frame and nothing else does", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  render(<ThemeToggle />);
  const root = document.documentElement;
  fireEvent.click(screen.getByRole("button", { name: t.toggleTheme }));
  expect(root.classList.contains("dark")).toBe(true);
  expect(root.hasAttribute("data-theme-switching")).toBe(true);
  while (frames.length) frames.shift()?.(0);
  expect(root.hasAttribute("data-theme-switching")).toBe(false);
  act(() => setSidebarCollapsed(true));
  expect(root.hasAttribute("data-theme-switching")).toBe(false);
  vi.unstubAllGlobals();
  const css = await readFile(
    join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  expect(css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")).toMatch(
    /:root\[data-theme-switching\] \*, :root\[data-theme-switching\] \*::before, :root\[data-theme-switching\] \*::after \{ transition: none !important; \}/,
  );
});
