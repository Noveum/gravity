// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  filterVisibilityKey,
  useFilterVisibility,
} from "../src/components/filter-visibility";

const firstScope = {
  userId: "fictional-reader",
  organizationId: "fictional-org",
};

function Preference({
  scope = firstScope,
  label = "Fictional filters",
}: {
  scope?: typeof firstScope;
  label?: string;
}) {
  const { visible, setVisible } = useFilterVisibility(scope);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={visible}
      onClick={() => setVisible((current) => !current)}
    >
      {visible ? "Visible" : "Hidden"}
    </button>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("filters default visible and explicit visibility survives a new mounted view", () => {
  const mounted = render(<Preference />);
  const control = screen.getByRole("button", { name: "Fictional filters" });
  expect(control.getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem(filterVisibilityKey(firstScope))).toBeNull();
  fireEvent.click(control);
  expect(control.getAttribute("aria-pressed")).toBe("false");
  expect(localStorage.getItem(filterVisibilityKey(firstScope))).toBe("hidden");
  mounted.unmount();
  render(<Preference />);
  const restored = screen.getByRole("button", { name: "Fictional filters" });
  expect(restored.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(restored);
  expect(localStorage.getItem(filterVisibilityKey(firstScope))).toBe("visible");
});

test("visibility stays scoped to the user and organization when the scope changes", () => {
  const mounted = render(<Preference />);
  fireEvent.click(screen.getByRole("button", { name: "Fictional filters" }));
  for (const scope of [
    { ...firstScope, userId: "another-fictional-reader" },
    { ...firstScope, organizationId: "another-fictional-org" },
  ]) {
    mounted.rerender(<Preference scope={scope} />);
    expect(
      screen
        .getByRole("button", { name: "Fictional filters" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  }
  mounted.rerender(<Preference />);
  expect(
    screen
      .getByRole("button", { name: "Fictional filters" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(filterVisibilityKey({ userId: "a/b", organizationId: "c" })).not.toBe(
    filterVisibilityKey({ userId: "a", organizationId: "b/c" }),
  );
});

test("multiple views and changes from another tab stay synchronized", () => {
  render(
    <>
      <Preference label="Fictional first view" />
      <Preference label="Fictional second view" />
    </>,
  );
  const first = screen.getByRole("button", { name: "Fictional first view" });
  const second = screen.getByRole("button", { name: "Fictional second view" });
  fireEvent.click(first);
  expect(second.getAttribute("aria-pressed")).toBe("false");
  act(() => {
    localStorage.setItem(filterVisibilityKey(firstScope), "visible");
    window.dispatchEvent(
      new StorageEvent("storage", { key: filterVisibilityKey(firstScope) }),
    );
  });
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(second.getAttribute("aria-pressed")).toBe("true");
});

test("storage failures retain a usable scoped preference for this session", () => {
  const scope = { ...firstScope, userId: "fictional-blocked-storage" };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const mounted = render(<Preference scope={scope} />);
  const control = screen.getByRole("button", { name: "Fictional filters" });
  expect(control.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(control);
  expect(control.getAttribute("aria-pressed")).toBe("false");
  mounted.unmount();
  render(<Preference scope={scope} />);
  const restored = screen.getByRole("button", { name: "Fictional filters" });
  expect(restored.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(restored);
  expect(restored.getAttribute("aria-pressed")).toBe("true");
});

test("server markup defaults visible and unrecognized saved values do not hide filters", () => {
  localStorage.setItem(filterVisibilityKey(firstScope), "hidden");
  expect(renderToString(<Preference />)).toContain('aria-pressed="true"');
  localStorage.setItem(filterVisibilityKey(firstScope), "unrecognized");
  render(<Preference />);
  expect(
    screen
      .getByRole("button", { name: "Fictional filters" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
