// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { Commands } from "../src/components/commands";
import {
  focusRecord,
  useKeyboardNavigation,
} from "../src/components/keyboard-navigation";
import { submitOnModEnter } from "../src/components/modal-lifecycle";

beforeAll(() => {
  // jsdom has no top layer. Exercise application lifecycle here; verify native dialogs in the browser.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector<HTMLElement>("input,button")?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("command palette interaction", () => {
  function Palette({ run }: { run: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Launch
        </button>
        {open && (
          <Commands
            onClose={() => setOpen(false)}
            commands={[
              {
                id: "people",
                title: "People",
                shortcut: "G P",
                run: () => run("people"),
              },
              {
                id: "locked",
                title: "Restricted",
                shortcut: "",
                disabled: true,
                run: () => run("locked"),
              },
              {
                id: "companies",
                title: "Companies",
                shortcut: "G C",
                run: () => run("companies"),
              },
            ]}
          />
        )}
      </>
    );
  }
  test("arrows skip disabled commands, wrap, and Enter runs the active command", async () => {
    const run = vi.fn();
    const user = userEvent.setup();
    render(<Palette run={run} />);
    const trigger = screen.getByRole("button", { name: "Launch" });
    await user.click(trigger);
    const search = screen.getByRole("combobox");
    expect(document.activeElement).toBe(search);
    await user.keyboard("{ArrowUp}");
    expect(
      screen
        .getByRole("option", { name: /Companies/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(run).toHaveBeenCalledExactlyOnceWith("companies");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  test("search narrows selection and an empty result never runs a command", async () => {
    const run = vi.fn();
    const user = userEvent.setup();
    render(<Palette run={run} />);
    await user.click(screen.getByRole("button", { name: "Launch" }));
    const search = screen.getByRole("combobox");
    await user.type(search, "does not exist");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("status").textContent).toBe(t.noCommands);
    expect(run).not.toHaveBeenCalled();
    await user.clear(search);
    await user.type(search, "comp");
    await user.keyboard("{Enter}");
    expect(run).toHaveBeenCalledExactlyOnceWith("companies");
  });
  test("IME and modified Enter do not execute palette commands", async () => {
    const run = vi.fn();
    const user = userEvent.setup();
    render(<Palette run={run} />);
    await user.click(screen.getByRole("button", { name: "Launch" }));
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    fireEvent.keyDown(search, { key: "Enter", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("record navigation and event ownership", () => {
  function Navigation({ run }: { run: (command: string) => boolean }) {
    useKeyboardNavigation(run);
    return (
      <>
        <input aria-label="Draft" />
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          Own keyboard
        </button>
        <section id="records-panel">
          <button type="button" data-nav-record="a">
            First
          </button>
          <button type="button" data-nav-record="disabled" disabled>
            Disabled
          </button>
          <a data-nav-record="b" href="/download">
            Material
          </a>
          <button type="button" data-nav-record="c">
            Last
          </button>
        </section>
      </>
    );
  }
  test("record movement respects DOM order without opening records or downloading materials", () => {
    render(<Navigation run={() => true} />);
    const clicked = vi.fn();
    screen.getByRole("link").addEventListener("click", clicked);
    expect(focusRecord("next")).toBe(true);
    expect(document.activeElement?.textContent).toBe("First");
    focusRecord("next");
    expect(document.activeElement?.textContent).toBe("Material");
    focusRecord("last");
    expect(document.activeElement?.textContent).toBe("Last");
    focusRecord("next");
    expect(document.activeElement?.textContent).toBe("Last");
    focusRecord("first");
    focusRecord("previous");
    expect(document.activeElement?.textContent).toBe("First");
    expect(clicked).not.toHaveBeenCalled();
  });
  test("typing and a child's consumed keys stay local while go-to chords and modifiers work", async () => {
    const run = vi.fn(() => true);
    const user = userEvent.setup();
    render(<Navigation run={run} />);
    const draft = screen.getByRole("textbox");
    await user.type(draft, "gn/?jk");
    expect(run).not.toHaveBeenCalled();
    await user.keyboard("{Control>}k{/Control}");
    expect(run).toHaveBeenLastCalledWith("commands");
    run.mockClear();
    await user.click(screen.getByRole("button", { name: "Own keyboard" }));
    await user.keyboard("j");
    expect(run).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "First" }).focus();
    await user.keyboard("gc");
    expect(run).toHaveBeenLastCalledWith("companies");
  });
  test("a menu keeps ArrowDown and go-to chords instead of triggering global navigation", () => {
    const run = vi.fn(() => true);
    render(<Navigation run={run} />);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "p" });
    menu.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

test("modifier Enter submits validated forms but does not submit composing input", async () => {
  const submit = vi.fn();
  render(
    <form
      onKeyDown={submitOnModEnter}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input aria-label="Required" required />
      <button type="submit">Save</button>
    </form>,
  );
  const input = screen.getByRole("textbox");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "valid" } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
});
