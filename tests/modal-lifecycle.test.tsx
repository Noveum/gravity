// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { useModalLifecycle } from "../src/components/modal-lifecycle";
import { RecordDialog } from "../src/components/records/record-dialog";

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

function RecordModal({ submit }: { submit: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open fictional editor
      </button>
      {open && (
        <RecordDialog
          title="Fictional editor"
          submitLabel="Save fictional editor"
          onClose={() => setOpen(false)}
          onSubmit={submit}
        >
          <input aria-label="Fictional field" data-primary-field />
        </RecordDialog>
      )}
    </>
  );
}

test("Escape closes only the record modal, consumes the workspace shortcut and restores trigger focus", () => {
  const workspaceKey = vi.fn();
  window.addEventListener("keydown", workspaceKey);
  try {
    render(<RecordModal submit={async () => null} />);
    const trigger = screen.getByRole("button", {
      name: "Open fictional editor",
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(
      fireEvent.keyDown(screen.getByLabelText("Fictional field"), {
        key: "Escape",
      }),
    ).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(workspaceKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  } finally {
    window.removeEventListener("keydown", workspaceKey);
  }
});

test("Escape during a pending record save stays in the modal and never reaches workspace shortcuts", async () => {
  let finish!: (value: string | null) => void;
  const pending = new Promise<string | null>((resolve) => {
    finish = resolve;
  });
  const workspaceKey = vi.fn();
  window.addEventListener("keydown", workspaceKey);
  try {
    render(<RecordModal submit={() => pending} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open fictional editor" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save fictional editor" }),
    );
    expect(
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }),
    ).toBe(false);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(workspaceKey).not.toHaveBeenCalled();
    await act(async () => finish(null));
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    window.removeEventListener("keydown", workspaceKey);
  }
});
