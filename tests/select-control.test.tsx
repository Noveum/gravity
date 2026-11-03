// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Select } from "../src/components/ui/select";
import { chooseSelect } from "./support/select-control";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("empty options and a real sentinel-like value remain distinct and round-trip through selection", async () => {
  const changed = vi.fn();
  function Picker() {
    const [value, setValue] = useState("");
    return (
      <Select
        label="Fictional tag"
        value={value}
        onChange={(next) => {
          setValue(next);
          changed(next);
        }}
        options={[
          { value: "", label: "All tags" },
          { value: "__gravity_all__", label: "Sentinel-like tag" },
          { value: "__gravity_all___", label: "Another sentinel-like tag" },
        ]}
      />
    );
  }
  render(<Picker />);
  const control = screen.getByRole("combobox", { name: "Fictional tag" });
  expect(control.textContent).toBe("All tags");
  await chooseSelect(control, "Sentinel-like tag");
  expect(changed).toHaveBeenLastCalledWith("__gravity_all__");
  await chooseSelect(control, "Another sentinel-like tag");
  expect(changed).toHaveBeenLastCalledWith("__gravity_all___");
  await chooseSelect(control, "All tags");
  expect(changed).toHaveBeenLastCalledWith("");
  expect(control.textContent).toBe("All tags");
});

test("a selected value missing from current facets stays labelled and can be cleared", async () => {
  const changed = vi.fn();
  const options = [{ value: "", label: "All qualifications" }];
  const mounted = render(
    <Select
      label="Fictional qualification"
      value="review_needed"
      options={options}
      onChange={changed}
    />,
  );
  const control = screen.getByRole("combobox", {
    name: "Fictional qualification",
  });
  expect(control.textContent).toBe("review needed");
  expect(control.title).toBe("review needed");
  fireEvent.keyDown(control, { key: "ArrowDown" });
  expect(
    (await screen.findByRole("option", { name: "review needed" })).getAttribute(
      "aria-selected",
    ),
  ).toBe("true");
  fireEvent.click(screen.getByRole("option", { name: "All qualifications" }));
  expect(changed).toHaveBeenLastCalledWith("");
  mounted.rerender(
    <Select
      label="Fictional qualification"
      value=""
      options={options}
      onChange={changed}
    />,
  );
  expect(control.textContent).toBe("All qualifications");
});

test("an open modal contains its portalled menu and Escape returns focus without changing selection", async () => {
  const changed = vi.fn();
  render(
    <dialog open aria-label="Fictional access dialog">
      <Select
        label="Fictional role"
        value="member"
        onChange={changed}
        options={[
          { value: "member", label: "Member" },
          { value: "admin", label: "Admin" },
        ]}
      />
    </dialog>,
  );
  const dialog = screen.getByRole("dialog", {
    name: "Fictional access dialog",
  });
  const control = within(dialog).getByRole("combobox", {
    name: "Fictional role",
  });
  control.focus();
  fireEvent.keyDown(control, { key: "ArrowDown" });
  const menu = await within(dialog).findByRole("listbox");
  expect(dialog.contains(menu)).toBe(true);
  expect(within(menu).getByRole("option", { name: "Member" })).toBeTruthy();
  await userEvent.setup().keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(document.activeElement).toBe(control);
  expect(changed).not.toHaveBeenCalled();
});

test("keyboard typeahead selects by option text without submitting the containing form", async () => {
  const submitted = vi.fn();
  function Picker() {
    const [value, setValue] = useState("alpha");
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <Select
          label="Fictional product"
          value={value}
          onChange={setValue}
          options={[
            { value: "alpha", label: "Alpha product" },
            { value: "beta", label: "Beta product" },
          ]}
        />
      </form>
    );
  }
  render(<Picker />);
  const control = screen.getByRole("combobox", { name: "Fictional product" });
  control.focus();
  await userEvent.setup().keyboard("b");
  expect(control.textContent).toBe("Beta product");
  expect(submitted).not.toHaveBeenCalled();
});

test("named controls submit actual values without exposing the internal empty sentinel and disabled fields are omitted", async () => {
  function Picker({ disabled }: { disabled: boolean }) {
    const [value, setValue] = useState("");
    return (
      <form aria-label="Fictional filter form">
        <Select
          label="Fictional tag"
          name="tag"
          value={value}
          disabled={disabled}
          onChange={setValue}
          options={[
            { value: "", label: "All tags" },
            { value: "__gravity_all__", label: "Sentinel-like tag" },
          ]}
        />
      </form>
    );
  }
  const mounted = render(<Picker disabled={false} />);
  const form = screen.getByRole("form", {
    name: "Fictional filter form",
  }) as HTMLFormElement;
  const control = screen.getByRole("combobox", { name: "Fictional tag" });
  expect(new FormData(form).getAll("tag")).toEqual([""]);
  await chooseSelect(control, "Sentinel-like tag");
  expect(new FormData(form).getAll("tag")).toEqual(["__gravity_all__"]);
  await chooseSelect(control, "All tags");
  expect(new FormData(form).getAll("tag")).toEqual([""]);
  mounted.rerender(<Picker disabled={true} />);
  expect(new FormData(form).has("tag")).toBe(false);
});
