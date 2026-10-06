// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { WorkspaceMenu } from "../src/components/shell/workspace-menu";

const organizations = [
  { id: "north", name: "Northstar Collective", slug: "north", timezone: "UTC" },
  { id: "lunar", name: "Lunar Studio", slug: "lunar", timezone: "UTC" },
];
afterEach(() => cleanup());
function mount(onSwitch = vi.fn()) {
  render(
    <aside className="sidebar" style={{ overflow: "hidden", width: 56 }}>
      <WorkspaceMenu
        organizations={organizations}
        organizationId="lunar"
        userName="Alex Morgan"
        userDetail="Demo"
        onSwitch={onSwitch}
      />
    </aside>,
  );
  return screen.getByRole("button", {
    name: `${t.switchOrganization}: Lunar Studio`,
  });
}
function open(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}
test("the workspace menu portals outside a clipping sidebar and includes workspace creation", async () => {
  open(mount());
  const menu = await screen.findByRole("menu");
  expect(document.querySelector(".sidebar")?.contains(menu)).toBe(false);
  expect(
    screen.getByRole("menuitem", { name: t.createWorkspace }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("menuitemradio", { name: "Lunar Studio" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});
test("arrow navigation, selection and Escape preserve keyboard focus", async () => {
  const onSwitch = vi.fn();
  const trigger = mount(onSwitch);
  open(trigger);
  const lunar = await screen.findByRole("menuitemradio", {
    name: "Lunar Studio",
  });
  await waitFor(() => expect(document.activeElement).toBe(lunar));
  fireEvent.keyDown(lunar, { key: "ArrowUp" });
  const north = screen.getByRole("menuitemradio", {
    name: "Northstar Collective",
  });
  await waitFor(() => expect(document.activeElement).toBe(north));
  fireEvent.keyDown(north, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  open(trigger);
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: "Northstar Collective" }),
  );
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith("north");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
test("the menu in a modal drawer stays within its focus boundary", async () => {
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
  open(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
  );
  expect(
    screen
      .getByRole("dialog", { name: "Navigation" })
      .contains(await screen.findByRole("menu")),
  ).toBe(true);
});
