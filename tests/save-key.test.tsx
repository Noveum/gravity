// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { submitOnSaveKey } from "../src/components/modal-lifecycle";

afterEach(cleanup);

function mount() {
  const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <dialog open>
      <form onKeyDown={submitOnSaveKey} onSubmit={submitted}>
        <input aria-label="Name" />
        <input type="checkbox" aria-label="Flag" />
        <a href="#help">Help</a>
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </form>
    </dialog>,
  );
  return submitted;
}

test("a plain E does nothing on Cancel, another button, a link or a checkbox", () => {
  const submitted = mount();
  for (const target of [
    screen.getByRole("button", { name: "Cancel" }),
    screen.getByRole("link", { name: "Help" }),
    screen.getByLabelText("Flag"),
    screen.getByLabelText("Name"),
  ])
    fireEvent.keyDown(target, { key: "e" });
  expect(submitted).not.toHaveBeenCalled();
});

test("a plain E on the submit button saves the dialog", () => {
  const submitted = mount();
  fireEvent.keyDown(screen.getByRole("button", { name: "Save" }), {
    key: "e",
  });
  expect(submitted).toHaveBeenCalledTimes(1);
});

test("Cmd or Ctrl Enter saves from anywhere in the form", () => {
  const submitted = mount();
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
    key: "Enter",
    metaKey: true,
  });
  fireEvent.keyDown(screen.getByRole("link", { name: "Help" }), {
    key: "Enter",
    ctrlKey: true,
  });
  fireEvent.keyDown(screen.getByLabelText("Name"), {
    key: "Enter",
    ctrlKey: true,
  });
  expect(submitted).toHaveBeenCalledTimes(3);
});
