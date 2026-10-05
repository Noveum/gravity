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
  maxToasts,
  Toaster,
  type ToastTone,
  toastDuration,
  useToasts,
} from "../src/components/ui/toaster";

function Harness() {
  const { toasts, notify, dismiss } = useToasts();
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
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
const region = () => screen.getByRole("region", { name: t.notifications });

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
  expect(screen.getByRole("status").textContent).toBe("Saved");
  expect(screen.getByRole("alert").textContent).toBe("Failed");
  act(() => {
    vi.advanceTimersByTime(toastDuration.success);
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(toastDuration.danger - toastDuration.success);
  });
  expect(region().children).toHaveLength(0);
});

test("the host keeps the newest toasts, collapses repeats and dismisses on request", () => {
  render(<Harness />);
  for (const name of ["one", "two", "three", "four"])
    fireEvent.click(screen.getByRole("button", { name }));
  expect([...region().children].map((toast) => toast.textContent)).toEqual([
    "Two",
    "Three",
    "Four",
  ]);
  expect(region().children).toHaveLength(maxToasts);
  fireEvent.click(screen.getByRole("button", { name: "four" }));
  expect(region().children).toHaveLength(maxToasts);
  const dismissButtons = screen.getAllByRole("button", { name: t.dismiss });
  fireEvent.click(dismissButtons[0] as HTMLButtonElement);
  expect([...region().children].map((toast) => toast.textContent)).toEqual([
    "Three",
    "Four",
  ]);
});
