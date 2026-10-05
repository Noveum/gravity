// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

test("a toast raised while a modal dialog is open is lifted above it", () => {
  const shownPopovers: Element[] = [];
  const hiddenPopovers: Element[] = [];
  const original = {
    show: HTMLElement.prototype.showPopover,
    hide: HTMLElement.prototype.hidePopover,
  };
  HTMLElement.prototype.showPopover = function () {
    shownPopovers.push(this);
  };
  HTMLElement.prototype.hidePopover = function () {
    hiddenPopovers.push(this);
  };
  try {
    render(<Harness />);
    const host = document.querySelector(
      `section[aria-label="${t.notifications}"]`,
    );
    expect(host?.getAttribute("popover")).toBe("manual");
    expect(shownPopovers).toEqual([host]);
    fireEvent.click(screen.getByRole("button", { name: "success" }));
    expect(shownPopovers).toHaveLength(1);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    fireEvent.click(screen.getByRole("button", { name: "danger" }));
    expect(hiddenPopovers).toEqual([host]);
    expect(shownPopovers).toEqual([host, host]);
    dialog.remove();
  } finally {
    HTMLElement.prototype.showPopover = original.show;
    HTMLElement.prototype.hidePopover = original.hide;
  }
});
