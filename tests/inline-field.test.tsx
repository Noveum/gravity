// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { InlineField } from "../src/components/records/inline-field";

afterEach(cleanup);

test("a live refresh keeps the draft and saves against the version editing began with", async () => {
  const save = vi.fn(async () => t.errors.CONFLICT);
  const original = { version: 3, summary: "Original" };
  const props = {
    label: t.personNotes,
    record: original,
    value: original.summary,
    multiline: true,
    onSave: save,
  };
  const view = render(<InlineField {...props} />);
  const notes = screen.getByLabelText(t.personNotes);
  fireEvent.change(notes, { target: { value: "My unsaved notes" } });
  view.rerender(
    <InlineField
      {...props}
      record={{ version: 4, summary: "Remote edit" }}
      value="Remote edit"
    />,
  );
  expect(notes).toHaveProperty("value", "My unsaved notes");
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t.errors.CONFLICT,
  );
  expect(save).toHaveBeenCalledWith("My unsaved notes", original);
  expect(notes).toHaveProperty("value", "My unsaved notes");
  fireEvent.keyDown(notes, { key: "Escape" });
  expect(notes).toHaveProperty("value", "Remote edit");
});

test("duplicate submissions and cancellation cannot interrupt an in-flight save", async () => {
  let resolve: (error: string | null) => void = () => {};
  const save = vi.fn(
    () =>
      new Promise<string | null>((done) => {
        resolve = done;
      }),
  );
  render(
    <InlineField
      label={t.name}
      record={{ version: 1 }}
      value="Original"
      onSave={save}
    />,
  );
  const field = screen.getByLabelText(t.name);
  fireEvent.change(field, { target: { value: "Edited" } });
  const form = field.closest("form");
  if (!form) throw new Error("Missing field form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(save).toHaveBeenCalledTimes(1);
  expect(field).toHaveProperty("value", "Edited");
  await act(async () => resolve(null));
  expect(screen.queryByRole("button", { name: t.save })).toBeNull();
  expect(screen.getByRole("status")).toHaveProperty(
    "textContent",
    t.inlineEditing.saved,
  );
  expect(field).toHaveProperty("value", "Edited");
});
