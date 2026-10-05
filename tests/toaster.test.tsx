// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import {
  maxToasts,
  Toaster,
  type ToastTone,
  toastDuration,
  useToasts,
} from "../src/components/ui/toaster";

function Harness() {
  const { toasts, notify, dismiss, pause, resume } = useToasts();
  const send = (title: string, tone: ToastTone) => () => notify(title, tone);
  return (
    <>
      <button type="button" onClick={send("Saved", "success")}>
        success
      </button>
      <button type="button" onClick={send("Failed", "danger")}>
        danger
      </button>
      {["One", "Two", "Three", "Four"].map((title) => (
        <button key={title} type="button" onClick={send(title, "neutral")}>
          {title.toLowerCase()}
        </button>
      ))}
      <Toaster
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pause}
        onResume={resume}
      />
    </>
  );
}
const region = () => screen.getByRole("region", { name: t.notifications });
const shown = () => [...region().querySelectorAll(".toast")];
const lane = (role: "status" | "alert") => within(region()).getByRole(role);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a success toast leaves on its own while an error stays long enough to read", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "success" }));
  fireEvent.click(screen.getByRole("button", { name: "danger" }));
  expect(lane("status").textContent).toBe("Saved");
  expect(lane("alert").textContent).toBe("Failed");
  act(() => {
    vi.advanceTimersByTime(toastDuration.success);
  });
  expect(lane("status").children).toHaveLength(0);
  expect(lane("alert").children).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(toastDuration.danger - toastDuration.success);
  });
  expect(shown()).toHaveLength(0);
});

test("the host keeps the newest toasts, collapses repeats and dismisses on request", () => {
  render(<Harness />);
  for (const name of ["one", "two", "three", "four"])
    fireEvent.click(screen.getByRole("button", { name }));
  expect(shown().map((toast) => toast.textContent)).toEqual([
    "Two",
    "Three",
    "Four",
  ]);
  expect(shown()).toHaveLength(maxToasts);
  fireEvent.click(screen.getByRole("button", { name: "four" }));
  expect(shown()).toHaveLength(maxToasts);
  const dismissButtons = screen.getAllByRole("button", { name: t.dismiss });
  fireEvent.click(dismissButtons[0] as HTMLButtonElement);
  expect(shown().map((toast) => toast.textContent)).toEqual(["Three", "Four"]);
});

test("toasts are inserted into live regions that exist before the first message", () => {
  render(<Harness />);
  const polite = lane("status");
  const assertive = lane("alert");
  expect(polite.children).toHaveLength(0);
  expect(assertive.children).toHaveLength(0);
  expect(polite.getAttribute("aria-live")).toBe("polite");
  expect(assertive.getAttribute("aria-live")).toBe("assertive");
  expect(polite.getAttribute("aria-atomic")).toBe("false");
  expect(assertive.getAttribute("aria-atomic")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "success" }));
  fireEvent.click(screen.getByRole("button", { name: "danger" }));
  expect(lane("status")).toBe(polite);
  expect(lane("alert")).toBe(assertive);
  expect(polite.textContent).toBe("Saved");
  expect(assertive.textContent).toBe("Failed");
});

test("hovering or focusing the toasts holds them until the pointer and focus leave", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "success" }));
  act(() => {
    vi.advanceTimersByTime(toastDuration.success - 1000);
  });
  fireEvent.pointerEnter(region());
  act(() => {
    vi.advanceTimersByTime(toastDuration.success * 3);
  });
  expect(shown()).toHaveLength(1);
  fireEvent.pointerLeave(region());
  act(() => {
    vi.advanceTimersByTime(999);
  });
  expect(shown()).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(shown()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "danger" }));
  const dismiss = screen.getByRole("button", { name: t.dismiss });
  act(() => dismiss.focus());
  act(() => {
    vi.advanceTimersByTime(toastDuration.danger * 2);
  });
  expect(shown()).toHaveLength(1);
  act(() => dismiss.blur());
  act(() => {
    vi.advanceTimersByTime(toastDuration.danger);
  });
  expect(shown()).toHaveLength(0);
});

test("the host joins the top layer on mount where the Popover API exists", () => {
  const shownPopovers: Element[] = [];
  const original = HTMLElement.prototype.showPopover;
  HTMLElement.prototype.showPopover = function () {
    shownPopovers.push(this);
  };
  try {
    render(<Harness />);
    const host = document.querySelector(
      `section[aria-label="${t.notifications}"]`,
    );
    expect(host?.getAttribute("popover")).toBe("manual");
    expect(shownPopovers).toEqual([host]);
  } finally {
    HTMLElement.prototype.showPopover = original;
  }
});

test("while a modal dialog is open the toasts live inside it, stay usable, and return when it closes", async () => {
  render(<Harness />);
  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  await act(async () => {
    dialog.setAttribute("open", "");
  });
  fireEvent.click(screen.getByRole("button", { name: "danger" }));
  const toast = document.querySelector(".toast");
  expect(dialog.contains(toast)).toBe(true);
  expect(
    within(dialog).getByRole("region", { name: t.notifications }),
  ).toBeTruthy();
  fireEvent.pointerEnter(region());
  act(() => {
    vi.advanceTimersByTime(toastDuration.danger * 2);
  });
  expect(shown()).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: t.dismiss }));
  expect(shown()).toHaveLength(0);
  await act(async () => {
    dialog.removeAttribute("open");
  });
  expect(dialog.contains(region())).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "success" }));
  expect(dialog.contains(document.querySelector(".toast"))).toBe(false);
  dialog.remove();
});

test("the dialog watcher reads the page only when a dialog opens, closes, mounts or unmounts", async () => {
  render(<Harness />);
  const queries = vi.spyOn(document, "querySelectorAll");
  const watched = () =>
    queries.mock.calls.filter(([selector]) => selector === "dialog[open]")
      .length;
  const busy = document.createElement("div");
  await act(async () => {
    document.body.append(busy);
    busy.setAttribute("data-state", "open");
    busy.append(document.createElement("span"));
  });
  expect(watched()).toBe(0);
  const wrapper = document.createElement("div");
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  wrapper.append(dialog);
  await act(async () => {
    document.body.append(wrapper);
  });
  expect(watched()).toBe(1);
  expect(dialog.contains(region())).toBe(true);
  await act(async () => {
    dialog.removeAttribute("open");
  });
  expect(watched()).toBe(2);
  expect(dialog.contains(region())).toBe(false);
  await act(async () => {
    dialog.setAttribute("open", "");
  });
  await act(async () => {
    wrapper.remove();
  });
  expect(watched()).toBe(4);
  expect(document.body.contains(region())).toBe(true);
  queries.mockRestore();
  busy.remove();
});

test("dismissing a focused toast with the keyboard does not hold later toasts", async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "danger" }));
  act(() => screen.getByRole("button", { name: t.dismiss }).focus());
  await user.keyboard("{Enter}");
  vi.useFakeTimers();
  expect(shown()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "success" }));
  act(() => {
    vi.advanceTimersByTime(toastDuration.success);
  });
  expect(shown()).toHaveLength(0);
});

test("dismissing the toast under the pointer does not hold later toasts", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "danger" }));
  fireEvent.pointerEnter(region());
  fireEvent.click(screen.getByRole("button", { name: t.dismiss }));
  expect(shown()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "success" }));
  act(() => {
    vi.advanceTimersByTime(toastDuration.success);
  });
  expect(shown()).toHaveLength(0);
});
