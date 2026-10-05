// @vitest-environment jsdom
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
