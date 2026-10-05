// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { WorkspaceMenu } from "../src/components/shell/workspace-menu";

const organizations = [
  { id: "north", name: "Northstar Collective", slug: "north", timezone: "UTC" },
  { id: "lunar", name: "Lunar Studio", slug: "lunar", timezone: "UTC" },
];
let anchor = { left: 8, top: 8, right: 48, bottom: 44 };

beforeEach(() => {
  anchor = { left: 8, top: 8, right: 48, bottom: 44 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rect = this.hasAttribute("data-workspace-trigger")
        ? anchor
        : { left: 0, top: 0, right: 0, bottom: 0 };
      return {
        ...rect,
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        toJSON: () => rect,
      } as DOMRect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(onSwitch = vi.fn(), organizationId = "lunar") {
  render(
    <aside className="sidebar" style={{ overflow: "hidden", width: 56 }}>
      <WorkspaceMenu
        organizations={organizations}
        organizationId={organizationId}
        userName="Alex Morgan"
        userDetail="Demo"
        onSwitch={onSwitch}
      />
    </aside>,
  );
  return screen.getByRole("button", {
    name:
      organizationId === "lunar"
        ? `${t.switchOrganization}: Lunar Studio`
        : `${t.switchOrganization}: Northstar Collective`,
  });
}

test("the menu renders outside the clipping sidebar, fixed under its trigger", () => {
  const trigger = mount();
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu");
  expect(document.querySelector(".sidebar")?.contains(menu)).toBe(false);
  const popup = menu.closest<HTMLElement>(".menu");
  expect(popup?.parentElement).toBe(document.body);
  expect(popup?.style.position).toBe("fixed");
  expect(popup?.style.top).toBe("48px");
  expect(popup?.style.left).toBe("8px");
});

test("the menu stays inside the viewport when its trigger sits near the right edge", () => {
  window.innerWidth = 300;
  anchor = { left: 200, top: 8, right: 296, bottom: 44 };
  fireEvent.click(mount());
  const popup = screen.getByRole("menu").closest<HTMLElement>(".menu");
  expect(Number.parseFloat(popup?.style.left ?? "")).toBe(300 - 256 - 8);
  window.innerWidth = 1024;
});

test("the menu opens on the current organization, holds only items, and returns focus on Escape", () => {
  const onSwitch = vi.fn();
  const trigger = mount(onSwitch);
  fireEvent.click(trigger);
  const lunar = screen.getByRole("menuitemradio", { name: "Lunar Studio" });
  expect(document.activeElement).toBe(lunar);
  const menu = screen.getByRole("menu");
  for (const child of menu.children)
    expect(["menuitem", "menuitemradio", "separator"]).toContain(
      child.getAttribute("role") ?? (child.tagName === "HR" ? "separator" : ""),
    );
  fireEvent.keyDown(lunar, { key: "ArrowUp" });
  expect(document.activeElement).toBe(
    screen.getByRole("menuitemradio", { name: "Northstar Collective" }),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: "Northstar Collective" }),
  );
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith("north");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Tab closes the menu and returns focus to the trigger instead of leaving it behind", () => {
  const trigger = mount();
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("inside a modal drawer the menu renders within the drawer so it stays reachable", () => {
  render(
    <aside role="dialog" aria-modal="true" aria-label="Navigation">
      <WorkspaceMenu
        organizations={organizations}
        organizationId="north"
        userName="Alex Morgan"
        userDetail="Demo"
        onSwitch={vi.fn()}
      />
    </aside>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
  );
  const drawer = screen.getByRole("dialog", { name: "Navigation" });
  const menu = screen.getByRole("menu");
  expect(drawer.contains(menu)).toBe(true);
  expect(document.activeElement).toBe(
    screen.getByRole("menuitemradio", { name: "Northstar Collective" }),
  );
});
