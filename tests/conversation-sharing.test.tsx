// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { ConversationSharing } from "../src/components/records/conversation-sharing";

const own = {
  id: "own",
  ownerId: "you",
  channel: "gmail" as const,
  provenance: "provider" as const,
  visibility: "private" as const,
  preview: "Fictional customer conversation",
};
const other = {
  id: "other",
  ownerId: "teammate",
  channel: "gmail" as const,
  provenance: "provider" as const,
  visibility: "product" as const,
  preview: "A different conversation",
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
test("only owned threads have access controls, and sharing requires confirmation with the product scope", async () => {
  const onChange = vi.fn(async () => null);
  render(
    <ConversationSharing
      conversations={[own, other]}
      userId="you"
      productName="Fictional product"
      busy={false}
      onChange={onChange}
    />,
  );
  expect(screen.queryByRole("button", { name: t.unshareThread })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t.shareThread }));
  const dialog = screen.getByRole("region", {
    name: /Share thread|Make private/,
  });
  expect(dialog.textContent).toContain(
    t.shareThreadDescription.replace("{product}", "Fictional product"),
  );
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: t.cancel }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t.shareThread }));
  await act(async () =>
    fireEvent.submit(
      screen
        .getByRole("region", {
          name: /Share thread|Make private/,
        })
        .querySelector("form") as HTMLFormElement,
    ),
  );
  expect(onChange).toHaveBeenCalledExactlyOnceWith(own, "product");
  expect(screen.queryByRole("dialog")).toBeNull();
});
test("pending and failed sharing keep the dialog safe from duplicate submissions", async () => {
  let resolve!: (error: string | null) => void;
  const onChange = vi.fn(
    () =>
      new Promise<string | null>((done) => {
        resolve = done;
      }),
  );
  render(
    <ConversationSharing
      conversations={[{ ...own, visibility: "product" }]}
      userId="you"
      productName="Product"
      busy={false}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: t.unshareThread }));
  const dialog = screen.getByRole("region", {
    name: /Share thread|Make private/,
  });
  expect(dialog.textContent).toContain(t.unshareThreadDescription);
  const form = dialog.querySelector("form") as HTMLFormElement;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: t.cancel }).matches(":disabled"),
  ).toBe(true);
  await act(async () => resolve(t.errors.CONFLICT));
  expect(
    screen.getByRole("region", {
      name: /Share thread|Make private/,
    }),
  ).toBeTruthy();
  expect(
    within(dialog).getByRole("button", { name: t.cancel }).matches(":disabled"),
  ).toBe(false);
});
