// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { useModalLifecycle } from "../src/components/modal-lifecycle";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector<HTMLInputElement>("input")?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
function Modal({
  busy = false,
  search = false,
  dirty = false,
  close,
}: {
  busy?: boolean;
  search?: boolean;
  dirty?: boolean;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalLifecycle(ref);
  return (
    <dialog
      ref={ref}
      data-dirty={dirty || undefined}
      aria-label="Fictional confirmation"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
    >
      <input aria-label="Fictional field" type={search ? "search" : "text"} />
    </dialog>
  );
}
function outside() {
  const dialog = screen.getByRole("dialog");
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 300,
    top: 100,
    bottom: 300,
  } as DOMRect);
  fireEvent.click(dialog, { clientX: 20, clientY: 20 });
}
test("a clean backdrop requests dismissal, inside padding does not, and cleanup restores focus", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const close = vi.fn();
  const view = render(<Modal close={close} />);
  const dialog = screen.getByRole("dialog");
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 300,
    top: 100,
    bottom: 300,
  } as DOMRect);
  fireEvent.click(dialog, { clientX: 120, clientY: 120 });
  expect(close).not.toHaveBeenCalled();
  outside();
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
test("edited fields retain their draft on backdrop clicks", () => {
  const close = vi.fn();
  render(<Modal close={close} />);
  fireEvent.change(screen.getByLabelText("Fictional field"), {
    target: { value: "Unsaved work" },
  });
  outside();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Fictional field")).toHaveProperty(
    "value",
    "Unsaved work",
  );
});
test("search terms do not become unsaved work, while a pending confirmation cannot close", () => {
  const close = vi.fn();
  const view = render(<Modal search close={close} />);
  fireEvent.change(screen.getByLabelText("Fictional field"), {
    target: { value: "Find shortcut" },
  });
  outside();
  expect(close).toHaveBeenCalledOnce();
  close.mockClear();
  view.rerender(<Modal search dirty close={close} />);
  outside();
  expect(close).not.toHaveBeenCalled();
  view.rerender(<Modal search busy close={close} />);
  outside();
  expect(close).not.toHaveBeenCalled();
});
