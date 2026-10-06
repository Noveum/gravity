// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { ProductTour } from "../src/components/public-site/product-tour";

afterEach(cleanup);
test("the tour explains its fictional data and opens the selected person's context", () => {
  render(<ProductTour />);
  expect(screen.getByText(t.publicSite.tourDescription)).toBeTruthy();
  const first = t.publicSite.previewTasks[0];
  const second = t.publicSite.previewTasks[1];
  expect(screen.getByText(first.context)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(second.name) }),
  );
  expect(screen.getByText(second.context)).toBeTruthy();
  expect(screen.queryByText(first.context)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: new RegExp(second.name) })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
test("product switching narrows the queue and updates the context without retaining a different product's contact", () => {
  render(<ProductTour />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  const task = t.publicSite.previewTasks[2];
  expect(screen.getByText(task.context)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Mira Chen/ })).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: /Mira Chen/ })).toBeTruthy();
});
test("tabs support keyboard navigation and dashboard cards open their related view", () => {
  render(<ProductTour />);
  const actions = screen.getByRole("tab", {
    name: t.publicSite.tourTabs.actions,
  });
  for (const tab of screen.getAllByRole("tab")) {
    const panel = document.getElementById(
      tab.getAttribute("aria-controls") ?? "",
    );
    expect(panel).toBeTruthy();
    expect(panel?.hidden).toBe(tab.getAttribute("aria-selected") !== "true");
  }
  actions.focus();
  fireEvent.keyDown(actions, { key: "ArrowRight" });
  const sequences = screen.getByRole("tab", {
    name: t.publicSite.tourTabs.sequences,
  });
  expect(document.activeElement).toBe(sequences);
  expect(sequences.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText(t.publicSite.tourSequenceNote)).toBeTruthy();
  fireEvent.keyDown(sequences, { key: "End" });
  const panel = screen.getByRole("tabpanel");
  expect(
    screen
      .getByRole("tab", { name: t.publicSite.tourTabs.overview })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(
    within(panel).getByRole("button", { name: /Open follow-ups/ }),
  );
  expect(actions.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(actions);
});
