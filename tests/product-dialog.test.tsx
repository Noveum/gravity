// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { ProductDialog } from "../src/components/product-dialog";
import { ShortcutHint } from "../src/components/ui/shortcut-hint";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a pending product submit cannot duplicate writes or close; a failed write keeps the entered name", async () => {
  let release = (_value: boolean) => {};
  const mutate = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const close = vi.fn();
  render(
    <ProductDialog
      organizationId="org-a"
      organizationName="Fictional workspace"
      mutate={mutate}
      onClose={close}
    />,
  );
  const input = screen.getByLabelText(t.productName);
  fireEvent.change(input, { target: { value: "  Fictional product  " } });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  expect(mutate).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith({
    operation: "product",
    organizationId: "org-a",
    name: "Fictional product",
  });
  expect(
    screen.getByRole("button", { name: t.cancel }).matches(":disabled"),
  ).toBe(true);
  expect(
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    ),
  ).toBe(false);
  expect(close).not.toHaveBeenCalled();
  release(false);
  await waitFor(() => expect(input.matches(":disabled")).toBe(false));
  expect((input as HTMLInputElement).value).toBe("  Fictional product  ");
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(close).toHaveBeenCalledOnce();
});

test("modifier hints match the platform and stay out of action accessible names", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const { container, rerender } = render(
    <button type="button">
      Save
      <ShortcutHint keys={t.keys.submit} />
    </button>,
  );
  expect(container.querySelector("kbd")?.textContent).toBe("⌘ Enter");
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  vi.stubGlobal("navigator", { platform: "Win32" });
  rerender(
    <button type="button">
      Save
      <ShortcutHint key="windows" keys={t.keys.submit} />
    </button>,
  );
  expect(container.querySelector("kbd")?.textContent).toBe("Ctrl Enter");
});
