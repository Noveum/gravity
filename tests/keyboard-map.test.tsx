// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { nextWorkingMorning, snoozeLabel } from "../packages/core/calendar";
import { OutreachService } from "../packages/core/outreach";
import {
  bindingLabel,
  type ShortcutId,
  shortcuts,
} from "../packages/core/shortcuts";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { dateLabel, requestJson } from "../src/components/client-api";
import { adjacentOpenStage } from "../src/components/crm/use-stage-moves";
import { outreachPath, sectionPath } from "../src/components/routes";
import { Shortcuts } from "../src/components/shortcuts";
import {
  installCrmHarness,
  mountCrm,
  organizations,
} from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const covered = new Set<ShortcutId>();
const binding = (id: ShortcutId) => {
  covered.add(id);
  return id;
};
const rows = () => [
  ...document.querySelectorAll<HTMLElement>("#records-panel [data-nav-record]"),
];
const row = (pattern: RegExp) => screen.getByRole("button", { name: pattern });
const peek = () =>
  screen.queryByRole("complementary", { name: t.recordDetails });
const press = (keys: string) => userEvent.setup().keyboard(keys);
const pathname = () => window.location.pathname;
async function actionRow(id: number) {
  const [action] = await harness.local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, demoId(id)));
  return action;
}

describe("go-to chords", () => {
  const chords = shortcuts.filter((entry) => entry.section === "navigation");
  test.each(chords.map((entry) => [entry.id, entry] as const))(
    "%s navigates to its view and focuses its title",
    async (id, entry) => {
      binding(id);
      await mountCrm(
        harness,
        entry.view === "actions" ? "/people" : "/actions",
      );
      const [first, second] = (entry.bindings[0] ?? "").split(" ");
      await press(`${first}${second}`);
      await waitFor(() =>
        expect(pathname()).toBe(
          entry.view === "outreach"
            ? outreachPath("today")
            : sectionPath(entry.view ?? "actions"),
        ),
      );
    },
  );
  test("a chord typed slower than the timeout does nothing and P alone focuses the product filter", async () => {
    binding("product");
    await mountCrm(harness);
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    fireEvent.keyDown(document.body, { key: "g" });
    now.mockReturnValue(3000);
    fireEvent.keyDown(document.body, { key: "p" });
    now.mockRestore();
    expect(pathname()).toBe("/actions");
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: t.product }),
    );
  });
});

describe("list movement, peek and open", () => {
  test("J, K, arrows, Home and End move the focus through rows", async () => {
    for (const id of ["next", "previous", "first", "last"] as const)
      binding(id);
    await mountCrm(harness);
    const order = rows();
    expect(order.length).toBeGreaterThan(3);
    await press("j");
    expect(document.activeElement).toBe(order[0]);
    await press("j{ArrowDown}");
    expect(document.activeElement).toBe(order[2]);
    await press("k");
    expect(document.activeElement).toBe(order[1]);
    await press("{ArrowUp}");
    expect(document.activeElement).toBe(order[0]);
    await press("{End}");
    expect(document.activeElement).toBe(order.at(-1));
    await press("{Home}");
    expect(document.activeElement).toBe(order[0]);
  });
  test("Space peeks the focused action and Enter opens its record", async () => {
    binding("peek");
    binding("open");
    await mountCrm(harness);
    row(/Ellis Park.*Verify role/).focus();
    await press(" ");
    await waitFor(() => expect(peek()).toBeTruthy());
    expect(pathname()).toBe("/actions");
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(205)}`));
    expect(window.location.search).toContain(`action=${demoId(605)}`);
  });
});

describe("Escape backs out one level", () => {
  test("peek, then selection, then the record page each close in turn and focus returns to the row", async () => {
    binding("back");
    await mountCrm(harness);
    const ellis = row(/Ellis Park.*Verify role/);
    ellis.focus();
    await press("x");
    await press(" ");
    await waitFor(() => expect(peek()).toBeTruthy());
    ellis.focus();
    await press("{Escape}");
    expect(peek()).toBeNull();
    expect(ellis.dataset.selected).toBe("true");
    await press("{Escape}");
    expect(ellis.dataset.selected).toBeUndefined();
    row(/Ellis Park.*Verify role/).focus();
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(205)}`));
    await waitFor(() =>
      expect(document.activeElement?.hasAttribute("data-record-heading")).toBe(
        true,
      ),
    );
    await press("{Escape}");
    await waitFor(() => expect(pathname()).toBe("/actions"));
    await waitFor(() =>
      expect(document.activeElement).toBe(row(/Ellis Park.*Verify role/)),
    );
  });
  test("Escape on a record returns to the list that record was opened from, not an older one", async () => {
    await mountCrm(harness);
    row(/Ellis Park.*Verify role/).focus();
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(205)}`));
    await press("gp");
    await waitFor(() => expect(pathname()).toBe("/people"));
    const leena = screen.getByRole("link", { name: /Leena Rao/ });
    leena.focus();
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(202)}`));
    await press("{Escape}");
    await waitFor(() => expect(pathname()).toBe("/people"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: /Leena Rao/ }),
      ),
    );
    screen.getByRole("link", { name: /Ellis Park/ }).focus();
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(205)}`));
    await press("{Escape}");
    await waitFor(() => expect(pathname()).toBe("/people"));
  });
  test("a record page reached by a deep link backs out to its list", async () => {
    await mountCrm(harness, `/companies/${demoId(100)}`);
    await press("{Escape}");
    await waitFor(() => expect(pathname()).toBe("/companies"));
  });
  test("in the search field Escape clears the text, then leaves the field", async () => {
    await mountCrm(harness);
    const search = screen.getByRole("searchbox", { name: t.search });
    await userEvent.setup().type(search, "Ellis");
    await press("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(search);
    await press("{Escape}");
    expect(document.activeElement).not.toBe(search);
  });
});

describe("palette, search, guide and create", () => {
  test("Cmd K opens the palette even from a text field, and it finds people, companies and actions", async () => {
    binding("palette");
    await mountCrm(harness);
    screen.getByRole("searchbox", { name: t.search }).focus();
    await press("{Meta>}k{/Meta}");
    const search = await screen.findByRole("combobox", {
      name: t.commandSearch,
    });
    await userEvent.setup().type(search, "harbor");
    const results = screen.getByRole("group", { name: t.paletteRecords });
    expect(
      within(results).getByRole("option", { name: /^Harbor Analytics/ }),
    ).toBeTruthy();
    expect(
      within(results).getByRole("option", { name: /Jonah Reed/ }),
    ).toBeTruthy();
    await userEvent.setup().clear(search);
    await userEvent.setup().type(search, "pilot proposal");
    expect(
      within(screen.getByRole("group", { name: t.paletteRecords })).getByRole(
        "option",
        { name: /Prepare the pilot proposal.*Leena Rao/ },
      ),
    ).toBeTruthy();
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(202)}`));
    expect(window.location.search).toContain(`action=${demoId(602)}`);
  });
  test("a company found in the palette opens its record", async () => {
    await mountCrm(harness);
    await press("{Control>}k{/Control}");
    await userEvent
      .setup()
      .type(screen.getByRole("combobox", { name: t.commandSearch }), "cedar");
    await press("{Enter}");
    await waitFor(() => expect(pathname()).toBe(`/companies/${demoId(102)}`));
  });
  test("slash focuses the view search, and opens the palette on a view without one", async () => {
    binding("search");
    await mountCrm(harness);
    await press("/");
    expect(document.activeElement).toBe(
      screen.getByRole("searchbox", { name: t.search }),
    );
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
    });
    await mountCrm(harness, `/people/${demoId(200)}`);
    await press("/");
    expect(
      screen.getByRole("combobox", { name: t.commandSearch }),
    ).toBeTruthy();
  });
  test("? opens the guide generated from the registry", async () => {
    binding("help");
    await mountCrm(harness);
    await press("?");
    const guide = screen.getByRole("dialog", { name: t.keyboardHelp });
    expect(within(guide).getByText(t.shortcutLabels.done)).toBeTruthy();
  });
  test("C creates in the current view: an action, a person, an upload or an action for the open person", async () => {
    binding("create");
    await mountCrm(harness);
    await press("c");
    expect(screen.getByRole("dialog", { name: t.scheduleAction })).toBeTruthy();
    fireEvent(
      screen.getByRole("dialog", { name: t.scheduleAction }),
      new Event("cancel"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: t.scheduleAction }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole("link", { name: t.people }));
    await waitFor(() => expect(pathname()).toBe("/people"));
    (document.activeElement as HTMLElement | null)?.blur();
    await press("c");
    expect(screen.getByRole("dialog", { name: t.addPerson })).toBeTruthy();
  });
  test("C on a person record schedules for that person, and on a view without its own create adds a person", async () => {
    await mountCrm(harness, `/people/${demoId(202)}`);
    await press("c");
    const dialog = await screen.findByRole("dialog", {
      name: t.scheduleAction,
    });
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole("combobox", {
            name: t.person,
          }) as HTMLSelectElement
        ).value,
      ).toBe(demoId(302)),
    );
    fireEvent(dialog, new Event("cancel"));
    fireEvent.click(screen.getByRole("link", { name: t.sequences }));
    await waitFor(() => expect(pathname()).toBe("/outreach/sequences"));
    (document.activeElement as HTMLElement | null)?.blur();
    await press("c");
    expect(screen.getByRole("dialog", { name: t.addPerson })).toBeTruthy();
  });
  test("C on materials opens the upload dialog", async () => {
    await mountCrm(harness, "/materials");
    await press("c");
    expect(
      screen.getByRole("heading", { name: t.upload, level: 2 }),
    ).toBeTruthy();
  });
  test("Shift P opens product creation for an admin and Shift O starts a new workspace", async () => {
    binding("create-product");
    binding("create-organization");
    await mountCrm(harness, "/companies");
    await press("{Shift>}P{/Shift}");
    const dialog = screen.getByRole("dialog", { name: t.newProduct });
    expect(within(dialog).getByText(organizations[0]?.name ?? "")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: t.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await press("{Shift>}O{/Shift}");
    await waitFor(() => expect(pathname()).toBe("/onboarding"));
  });
  test("N schedules an action from any view", async () => {
    binding("schedule");
    await mountCrm(harness, "/companies");
    await press("n");
    expect(screen.getByRole("dialog", { name: t.scheduleAction })).toBeTruthy();
  });
});

describe("shell bindings", () => {
  test("[ closes the open drawer on a narrow screen", async () => {
    const wide = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("max-width"),
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    try {
      await mountCrm(harness);
      await press("[[");
      await waitFor(() =>
        expect(
          document.querySelector(".sidebar")?.getAttribute("data-drawer"),
        ).toBe("open"),
      );
      await press("[[");
      await waitFor(() =>
        expect(
          document.querySelector(".sidebar")?.getAttribute("data-drawer"),
        ).toBe("closed"),
      );
    } finally {
      window.matchMedia = wide;
    }
  });
  test("[ toggles the sidebar", async () => {
    binding("sidebar");
    await mountCrm(harness);
    await press("[[");
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    await press("[[");
    expect(document.documentElement.dataset.sidebar).toBe("expanded");
  });
  test("Cmd Shift L toggles the theme, also while typing, and the choice persists", async () => {
    binding("theme");
    await mountCrm(harness);
    const dark = document.documentElement.classList.contains("dark");
    await press("{Meta>}{Shift>}l{/Shift}{/Meta}");
    expect(document.documentElement.classList.contains("dark")).toBe(!dark);
    screen.getByRole("searchbox", { name: t.search }).focus();
    await press("{Control>}{Shift>}L{/Shift}{/Control}");
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
    expect(localStorage.getItem("gravity-theme")).toBe(dark ? "dark" : "light");
  });
  test("O focuses the workspace menu", async () => {
    binding("organization");
    await mountCrm(harness);
    await press("o");
    await waitFor(() =>
      expect(
        document.activeElement?.hasAttribute("data-workspace-trigger"),
      ).toBe(true),
    );
  });
});

describe("selection and row verbs", () => {
  test("X toggles a row and Shift J or K extends and shrinks the selection", async () => {
    binding("select");
    binding("extend-next");
    binding("extend-previous");
    await mountCrm(harness);
    const order = rows();
    order[0]?.focus();
    await press("x");
    expect(order[0]?.dataset.selected).toBe("true");
    expect(
      screen.getByRole("button", {
        name: `${t.selectedCount.replace("{count}", "1")}: ${t.clearSelection}`,
      }),
    ).toBeTruthy();
    await press("{Shift>}j{/Shift}{Shift>}J{/Shift}");
    expect(rows().filter((item) => item.dataset.selected)).toEqual(
      order.slice(0, 3),
    );
    await press("{Shift>}K{/Shift}");
    expect(rows().filter((item) => item.dataset.selected)).toEqual(
      order.slice(0, 2),
    );
    await press("x");
    expect(rows().filter((item) => item.dataset.selected)).toEqual(
      order.slice(0, 1),
    );
  });
  test("D marks the selected actions done with one request, and Undo in the toast restores them", async () => {
    binding("done");
    await mountCrm(harness);
    row(/Ellis Park.*Verify role/).focus();
    await press("x{Shift>}j{/Shift}");
    const selected = rows()
      .filter((item) => item.dataset.selected)
      .map((item) => item.dataset.actionId);
    expect(selected).toHaveLength(2);
    await press("d");
    await waitFor(() =>
      expect(
        rows().some((item) => selected.includes(item.dataset.actionId)),
      ).toBe(false),
    );
    expect(
      harness.posts.filter((post) => post.operation === "plan"),
    ).toHaveLength(1);
    expect((await actionRow(605)).status).toBe("completed");
    expect(document.activeElement?.hasAttribute("data-nav-record")).toBe(true);
    const toast = screen.getByText(
      t.verbDone.replace("{count}", t.actionCount.replace("{count}", "2")),
    ).parentElement as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: t.undo }));
    await waitFor(() => expect(row(/Ellis Park.*Verify role/)).toBeTruthy());
    expect((await actionRow(605)).status).toBe("open");
    await screen.findByText(t.verbUndone);
  });
  test("D on a paused reply refuses instead of completing it", async () => {
    await mountCrm(harness);
    row(/Mira Chen.*Follow-up 2 paused/).focus();
    await press("d");
    await screen.findByText(t.errors.REPLY_BLOCKED);
    expect(harness.posts).toHaveLength(0);
  });
  test("S snoozes the focused action to the next working morning, moves it to Upcoming, and Cmd Z undoes it", async () => {
    binding("snooze");
    binding("undo");
    await mountCrm(harness);
    const before = await actionRow(605);
    const now = Date.now();
    const morning = nextWorkingMorning(now, "UTC");
    row(/Ellis Park.*Verify role/).focus();
    await press("s");
    await screen.findByText(
      t.verbSnoozed
        .replace("{count}", t.actionCountOne)
        .replace("{when}", snoozeLabel(morning, now, "UTC")),
    );
    expect((await actionRow(605)).dueAt.toISOString()).toBe(
      new Date(morning).toISOString(),
    );
    await waitFor(() =>
      expect(
        row(/Ellis Park.*Verify role/).parentElement?.querySelector(
          ".group-title",
        )?.textContent,
      ).toContain(label("upcoming")),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(row(/Ellis Park.*Verify role/)),
    );
    await press("{Meta>}z{/Meta}");
    await screen.findByText(t.verbUndone);
    expect((await actionRow(605)).dueAt.toISOString()).toBe(
      before.dueAt.toISOString(),
    );
    await waitFor(() =>
      expect(
        row(/Ellis Park.*Verify role/).parentElement?.querySelector(
          ".group-title",
        )?.textContent,
      ).toContain(label("now")),
    );
  });
  test("an undo refused because a teammate changed the row says so", async () => {
    await mountCrm(harness);
    row(/Ellis Park.*Verify role/).focus();
    await press("s");
    const toast = (
      await screen.findByText(new RegExp(t.verbSnoozed.split(" ")[0] ?? ""))
    ).parentElement as HTMLElement;
    const changed = await actionRow(605);
    await harness.service.planActions(
      { userId: "demo-teammate", source: "session" },
      {
        organizationId: demoId(1),
        items: [
          { actionId: changed.id, version: changed.version, ownerId: demoUser },
        ],
      },
    );
    fireEvent.click(within(toast).getByRole("button", { name: t.undo }));
    await screen.findByText(t.errors.CONFLICT);
    expect((await actionRow(605)).dueAt.toISOString()).toBe(
      changed.dueAt.toISOString(),
    );
  });
  test("a verb pressed while another request is in flight waits its turn instead of being dropped", async () => {
    await mountCrm(harness);
    const regular = vi.mocked(requestJson).getMockImplementation();
    if (!regular) throw new Error("REQUEST_MOCK_REQUIRED");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    vi.mocked(requestJson).mockImplementation(async (url, init) => {
      if (init?.method === "POST" && !held) {
        held = true;
        await gate;
      }
      return regular(url, init);
    });
    row(/Ellis Park.*Verify role/).focus();
    await press("s");
    row(/Jonah Reed.*Answer the API/).focus();
    await press("s");
    await act(async () => release());
    await waitFor(() =>
      expect(
        harness.posts.filter((post) => post.operation === "plan"),
      ).toHaveLength(2),
    );
    const morning = new Date(
      nextWorkingMorning(Date.now(), "UTC"),
    ).toISOString();
    await waitFor(async () =>
      expect((await actionRow(601)).dueAt.toISOString()).toBe(morning),
    );
    expect((await actionRow(605)).dueAt.toISOString()).toBe(morning);
  });
  test("a search prunes hidden rows from the selection, the chip counts what is left, and verbs never touch a hidden row", async () => {
    await mountCrm(harness);
    row(/Ellis Park.*Verify role/).focus();
    await press("x");
    row(/Jonah Reed.*Answer the API/).focus();
    await press("x");
    const chip = (count: number) =>
      screen.queryByRole("button", {
        name: `${t.selectedCount.replace("{count}", String(count))}: ${t.clearSelection}`,
      });
    expect(chip(2)).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: t.search });
    await userEvent.setup().type(search, "Jonah");
    await waitFor(() => expect(chip(1)).toBeTruthy());
    await userEvent.setup().clear(search);
    expect(chip(1)).toBeTruthy();
    expect(row(/Ellis Park.*Verify role/).dataset.selected).toBeUndefined();
    await userEvent.setup().type(search, "Leena");
    await waitFor(() => expect(chip(1)).toBeNull());
    await userEvent.setup().clear(search);
    row(/Leena Rao.*Prepare the pilot/).focus();
    await press("x");
    const leena = await actionRow(602);
    await userEvent.setup().type(search, "Ellis");
    await waitFor(() => expect(chip(1)).toBeNull());
    await act(async () => search.blur());
    row(/Ellis Park.*Verify role/).focus();
    await press("s");
    await screen.findByText(new RegExp(t.actionCountOne));
    expect((await actionRow(602)).dueAt.toISOString()).toBe(
      leena.dueAt.toISOString(),
    );
    expect((await actionRow(602)).version).toBe(leena.version);
    expect(harness.posts.at(-1)).toMatchObject({
      items: [expect.objectContaining({ actionId: demoId(605) })],
    });
  });
  test("A opens an assign menu that owns the keyboard, assigns, and offers undo", async () => {
    binding("assign");
    await mountCrm(harness);
    const ellis = row(/Ellis Park.*Verify role/);
    ellis.focus();
    await press("a");
    const menu = screen.getByRole("menu", { name: t.assignTo });
    const sam = within(menu).getByRole("menuitemradio", { name: /Sam Rivera/ });
    expect(sam.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(sam);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "g" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "p" });
    expect(pathname()).toBe("/actions");
    await press("{ArrowUp}");
    expect(document.activeElement).toBe(
      within(menu).getByRole("menuitemradio", { name: /Alex Morgan/ }),
    );
    await press("{Enter}");
    await screen.findByText(
      t.verbAssigned
        .replace("{count}", t.actionCountOne)
        .replace("{name}", "Alex Morgan"),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect((await actionRow(605)).ownerId).toBe(demoUser);
    expect(document.activeElement).toBe(row(/Ellis Park.*Verify role/));
    const toast = screen.getByText(
      t.verbAssigned
        .replace("{count}", t.actionCountOne)
        .replace("{name}", "Alex Morgan"),
    ).parentElement as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: t.undo }));
    await screen.findByText(t.verbUndone);
    expect((await actionRow(605)).ownerId).toBe("demo-teammate");
  });
  test("Escape closes the assign menu without assigning, and it lists only teammates who can see the product", async () => {
    await mountCrm(harness);
    row(/Theo Grant.*Review their promised introduction/).focus();
    await press("a");
    const menu = screen.getByRole("menu", { name: t.assignTo });
    expect(
      within(menu).queryByRole("menuitemradio", { name: /Restricted member/ }),
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitemradio", { name: /Sam Rivera/ }),
    ).toBeTruthy();
    await press("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(harness.posts).toHaveLength(0);
  });
});

describe("outreach verbs", () => {
  const touch = async (id: number) => {
    const [found] = await harness.local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.id, demoId(id)));
    if (!found) throw new Error("missing touch");
    return found;
  };
  const touchRow = (name: string) =>
    screen.findByRole("button", { name: new RegExp(`^${name}, `) });
  test("no key approves a touch, and E opens its draft where saving a change clears the approval", async () => {
    binding("touch-edit");
    expect(
      shortcuts
        .filter((entry) => entry.section === "outreach")
        .map((entry) => entry.id),
    ).not.toContain("touch-approve");
    await mountCrm(harness, "/outreach/today");
    (await touchRow("Noor Haddad")).focus();
    await press("a");
    expect(harness.posts).toEqual([]);
    expect((await touch(1307)).status).not.toBe("approved");
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${t.touchVerbs.approve}: Noor Haddad`,
      }),
    );
    await screen.findByText(t.touchApproved.replace("{name}", "Noor Haddad"));
    expect((await touch(1307)).status).toBe("approved");
    (await touchRow("Noor Haddad")).focus();
    await press("e");
    const editor = await screen.findByRole("dialog", {
      name: t.draftEditorTitle.replace("{name}", "Noor Haddad"),
    });
    expect(within(editor).getByText(t.approvalClearsOnEdit)).toBeTruthy();
    const field = within(editor).getByLabelText(t.draftLabel);
    expect(document.activeElement).toBe(field);
    await userEvent.setup().type(field, " Updated.");
    await press("{Meta>}{Enter}{/Meta}");
    await screen.findByText(t.draftSavedApprovalCleared);
    expect(await touch(1307)).toMatchObject({ status: "drafted" });
    expect((await touch(1307)).draft).toMatch(/Updated\.$/);
  });
  test("D records a send with an optional link, and a second report shows the first report's details", async () => {
    binding("touch-sent");
    const zone = organizations[0]?.timezone ?? "UTC";
    if (organizations[0]) organizations[0].timezone = "Asia/Tokyo";
    try {
      await mountCrm(harness, "/outreach/today");
      (await touchRow("Amara Stone")).focus();
      await press("d");
      const dialog = await screen.findByRole("dialog", {
        name: t.markSentTitle,
      });
      await userEvent
        .setup()
        .type(
          within(dialog).getByLabelText(t.markSentLink),
          "https://mail.example.test/m/1",
        );
      await press("{Meta>}{Enter}{/Meta}");
      const recorded = await screen.findByText(
        new RegExp(`^${t.touchMarkedSent.replace("{name}", "Amara Stone")}`),
      );
      expect(
        within(recorded.parentElement as HTMLElement).queryByRole("button", {
          name: t.undo,
        }),
      ).toBeNull();
      const posted = harness.posts.length;
      await press("{Meta>}z{/Meta}");
      expect(harness.posts).toHaveLength(posted);
      expect((await touch(1304)).status).toBe("sent");
      expect(await touch(1304)).toMatchObject({
        status: "sent",
        externalMessageId: "https://mail.example.test/m/1",
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: /^Amara Stone, / }),
        ).toBeNull(),
      );
      const sent = await new OutreachService(harness.local.db).markSent(
        { userId: demoUser, source: "demo" },
        {
          organizationId: demoId(1),
          touchId: demoId(1307),
          externalMessageId: "first-report-1",
        },
      );
      (await touchRow("Noor Haddad")).focus();
      await press("d");
      const again = await screen.findByRole("dialog", {
        name: t.markSentTitle,
      });
      await press("{Meta>}{Enter}{/Meta}");
      await waitFor(() =>
        expect(within(again).getByText(/Alex Morgan/)).toBeTruthy(),
      );
      const alert = within(again).getByText(/Alex Morgan/);
      expect(alert.getAttribute("role")).toBe("alert");
      expect(alert.textContent).toContain(
        dateLabel(sent.touch.sentAt?.toISOString() ?? "", "Asia/Tokyo"),
      );
      expect(alert.textContent).toContain(
        t.firstReportLink.replace("{link}", "first-report-1"),
      );
      expect(alert.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    } finally {
      if (organizations[0]) organizations[0].timezone = zone;
    }
  });
  test("Shift S skips with a reason and Undo reopens it; S snoozes to the next working morning and Cmd Z undoes it", async () => {
    binding("touch-skip");
    binding("touch-snooze");
    binding("touch-undo");
    await mountCrm(harness, "/outreach/today");
    (await touchRow("Ellis Park")).focus();
    await press("{Shift>}S{/Shift}");
    const dialog = await screen.findByRole("dialog", { name: t.skipTitle });
    await userEvent
      .setup()
      .type(within(dialog).getByLabelText(t.skipReason), "Met at an event");
    await press("{Meta>}{Enter}{/Meta}");
    const skipped = await screen.findByText(
      t.touchSkipped.replace("{name}", "Ellis Park"),
    );
    expect(await touch(1310)).toMatchObject({
      status: "skipped",
      skipReason: "Met at an event",
    });
    fireEvent.click(
      within(skipped.parentElement as HTMLElement).getByRole("button", {
        name: t.undo,
      }),
    );
    await screen.findByText(t.touchSkipUndone);
    expect(await touch(1310)).toMatchObject({ status: "drafted" });
    await touchRow("Ellis Park");
    const before = await touch(1307);
    const now = Date.now();
    const morning = nextWorkingMorning(now, "UTC");
    (await touchRow("Noor Haddad")).focus();
    await press("s");
    await screen.findByText(
      t.touchSnoozed
        .replace("{name}", "Noor Haddad")
        .replace("{when}", snoozeLabel(morning, now, "UTC")),
    );
    expect((await touch(1307)).dueAt.toISOString()).toBe(
      new Date(morning).toISOString(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Noor Haddad, / }),
      ).toBeNull(),
    );
    (await touchRow("Ellis Park")).focus();
    await press("{Meta>}z{/Meta}");
    await screen.findByText(t.verbUndone);
    expect((await touch(1307)).dueAt.toISOString()).toBe(
      before.dueAt.toISOString(),
    );
    await touchRow("Noor Haddad");
  });
});

describe("outreach pipeline", () => {
  const board = () =>
    screen.getByRole("region", {
      name: t.pipelineBoard.replace("{brand}", "AI Platform"),
    });
  const stage = (name: string) =>
    within(board()).getByRole("region", { name: new RegExp(`^${name}`) });
  const card = (name: string) =>
    within(board()).getByRole("button", { name: new RegExp(`^${name}`) });
  const moves = () =>
    harness.posts
      .filter((post) => post.operation === "relationship")
      .map((post) => post.stageId);
  async function openBoard() {
    await mountCrm(harness, "/outreach/pipeline");
    const prompt = await screen.findByRole("heading", {
      name: t.pipelineChooseBrand,
    });
    expect(prompt).toBeTruthy();
    expect(
      (
        screen.getByLabelText(t.product, {
          selector: "#pipeline-brand",
        }) as HTMLSelectElement
      ).value,
    ).toBe(demoId(10));
    fireEvent.click(screen.getByRole("button", { name: t.pipelineShow }));
    await waitFor(() => expect(board()).toBeTruthy());
  }
  test("Shift arrows move through open stages and never close, M closes only after confirmation, and a closed card refuses arrows", async () => {
    binding("move-to");
    await openBoard();
    const amara = within(stage(t.outreachStages.contacted)).getByRole(
      "button",
      { name: /^Amara Stone/ },
    );
    amara.focus();
    for (const name of [
      t.outreachStages.followUp,
      t.outreachStages.replied,
      t.outreachStages.meeting,
    ]) {
      await press("{Shift>}{ArrowRight}{/Shift}");
      await waitFor(() =>
        expect(
          within(stage(name)).getByRole("button", { name: /^Amara Stone/ }),
        ).toBeTruthy(),
      );
      await waitFor(() =>
        expect(document.activeElement).toBe(card("Amara Stone")),
      );
    }
    await press("{Shift>}{ArrowRight}{/Shift}");
    expect(await screen.findByText(t.relationshipOpenEnd)).toBeTruthy();
    expect(moves()).toEqual([demoId(1203), demoId(1204), demoId(1205)]);
    await press("m");
    const menu = screen.getByRole("menu", {
      name: t.moveToMenu.replace("{name}", "Amara Stone"),
    });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toHaveLength(9);
    fireEvent.click(
      within(menu).getByRole("menuitemradio", {
        name: new RegExp(`^${t.outreachStages.won}`),
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: t.closeStageTitle
        .replace("{name}", "Amara Stone")
        .replace("{stage}", t.outreachStages.won),
    });
    expect(moves()).toHaveLength(3);
    fireEvent.click(
      within(confirm).getByRole("button", {
        name: t.closeStageConfirm.replace("{stage}", t.outreachStages.won),
      }),
    );
    await waitFor(() =>
      expect(
        within(stage(t.outreachStages.won)).getByRole("button", {
          name: /^Amara Stone/,
        }),
      ).toBeTruthy(),
    );
    expect(moves()).toEqual([
      demoId(1203),
      demoId(1204),
      demoId(1205),
      demoId(1206),
    ]);
    card("Amara Stone").focus();
    await press("{Shift>}{ArrowLeft}{/Shift}");
    expect(await screen.findByText(t.relationshipClosedMove)).toBeTruthy();
    expect(moves()).toHaveLength(4);
  });
  test("two quick Shift arrows queue, each move uses the version the last one returned, and nothing conflicts", async () => {
    await openBoard();
    within(stage(t.outreachStages.contacted))
      .getByRole("button", { name: /^Amara Stone/ })
      .focus();
    await press("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    await waitFor(() =>
      expect(
        within(stage(t.outreachStages.replied)).getByRole("button", {
          name: /^Amara Stone/,
        }),
      ).toBeTruthy(),
    );
    expect(moves()).toEqual([demoId(1203), demoId(1204)]);
    expect(screen.queryByText(t.errors.CONFLICT)).toBeNull();
  });
  test("a drag into a closed stage asks first and Cancel leaves it, a drag between open stages moves at once, and cards show owner, next step and due date", async () => {
    await openBoard();
    const noor = card("Noor Haddad");
    const article = noor.closest("article") as HTMLElement;
    expect(article.textContent).toContain(
      "Send follow-up 2 with the case study",
    );
    expect(article.textContent).toContain("AM");
    expect(
      within(article).getByTitle(t.ownedBy.replace("{name}", "Alex Morgan")),
    ).toBeTruthy();
    fireEvent.dragStart(article);
    fireEvent.dragOver(stage(t.outreachStages.lost));
    fireEvent.drop(stage(t.outreachStages.lost));
    const confirm = await screen.findByRole("dialog", {
      name: t.closeStageTitle
        .replace("{name}", "Noor Haddad")
        .replace("{stage}", t.outreachStages.lost),
    });
    fireEvent.click(within(confirm).getByRole("button", { name: t.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moves()).toEqual([]);
    fireEvent.dragStart(card("Noor Haddad").closest("article") as HTMLElement);
    fireEvent.dragOver(stage(t.outreachStages.replied));
    fireEvent.drop(stage(t.outreachStages.replied));
    await waitFor(() =>
      expect(
        within(stage(t.outreachStages.replied)).getByRole("button", {
          name: /^Noor Haddad/,
        }),
      ).toBeTruthy(),
    );
    expect(moves()).toEqual([demoId(1204)]);
  });
});

describe("detail bindings", () => {
  test("E expands the peek, H returns to the list, L enters the detail and 1 2 3 switch tabs", async () => {
    for (const id of [
      "expand",
      "list-focus",
      "detail-focus",
      "timeline",
      "evidence",
      "draft",
    ] as const)
      binding(id);
    await mountCrm(harness);
    row(/Leena Rao.*Prepare the pilot proposal/).focus();
    await press(" ");
    await waitFor(() => expect(peek()).toBeTruthy());
    await screen.findByRole("button", { name: label("draft") });
    await press("e");
    expect(document.querySelector(".inspector-expanded")).toBeTruthy();
    await press("e");
    expect(document.querySelector(".inspector-expanded")).toBeNull();
    await press("l");
    expect(peek()?.contains(document.activeElement)).toBe(true);
    await press("2");
    expect(document.activeElement?.getAttribute("data-inspector-tab")).toBe(
      "evidence",
    );
    await press("1");
    expect(document.activeElement?.getAttribute("data-inspector-tab")).toBe(
      "timeline",
    );
    await press("3");
    expect(document.activeElement?.getAttribute("data-inspector-tab")).toBe(
      "draft",
    );
    await press("h");
    expect(document.activeElement?.hasAttribute("data-nav-record")).toBe(true);
  });
  test("B returns to the previous record in the peek", async () => {
    binding("previous-record");
    await mountCrm(harness, "/people");
    const mira = screen.getByRole("link", { name: /Mira Chen/ });
    mira.focus();
    await press(" ");
    await waitFor(() => expect(peek()).toBeTruthy());
    const company = screen.getByRole("link", { name: "Northstar Labs" });
    company.focus();
    await press(" ");
    await waitFor(() =>
      expect(
        within(peek() as HTMLElement).getByText(t.companyDetails),
      ).toBeTruthy(),
    );
    company.focus();
    await press("b");
    await waitFor(() =>
      expect(
        within(peek() as HTMLElement).getByText(t.relationships),
      ).toBeTruthy(),
    );
  });
});

describe("dialogs and safety", () => {
  test("E saves a dialog from its submit button, never from Cancel, and types E inside a field; Cmd Enter saves from a field", async () => {
    binding("save");
    await mountCrm(harness);
    row(/Leena Rao.*Prepare the pilot proposal/).focus();
    await press(" ");
    await waitFor(() => expect(peek()).toBeTruthy());
    const fill = async (text: string) => {
      const dialog = await screen.findByRole("dialog", {
        name: t.scheduleAction,
      });
      const title = within(dialog).getByRole("textbox", {
        name: t.actionTitle,
      }) as HTMLInputElement;
      await waitFor(() => expect(title.disabled).toBe(false));
      expect(
        (
          within(dialog).getByRole("combobox", {
            name: t.person,
          }) as HTMLSelectElement
        ).value,
      ).toBe(demoId(302));
      fireEvent.change(within(dialog).getByLabelText(t.dueDate), {
        target: { value: "2030-01-02T09:00" },
      });
      await userEvent.setup().type(title, text);
      return { dialog, title };
    };
    await press("n");
    const first = await fill("Send the recap e");
    expect(first.title.value).toBe("Send the recap e");
    expect(harness.posts).toHaveLength(0);
    within(first.dialog).getByRole("button", { name: t.cancel }).focus();
    await press("e");
    expect(harness.posts).toHaveLength(0);
    first.dialog
      .querySelector<HTMLButtonElement>("button[type='submit']")
      ?.focus();
    await press("e");
    await waitFor(() =>
      expect(
        harness.posts.filter((post) => post.operation === "schedule"),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: t.scheduleAction }),
      ).toBeNull(),
    );
    await waitFor(() => expect(peek()).toBeTruthy());
    await press("n");
    await fill("Second");
    await press("{Meta>}{Enter}{/Meta}");
    await waitFor(() =>
      expect(
        harness.posts.filter((post) => post.operation === "schedule"),
      ).toHaveLength(2),
    );
  });
  test("single keys pause in a text field and while a dialog owns the keyboard", async () => {
    await mountCrm(harness);
    const search = screen.getByRole("searchbox", { name: t.search });
    await userEvent.setup().type(search, "gpdxc[[");
    expect(pathname()).toBe("/actions");
    expect(harness.posts).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.documentElement.dataset.sidebar).not.toBe("collapsed");
    await act(async () => search.blur());
    await press("?");
    expect(screen.getByRole("dialog", { name: t.keyboardHelp })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "p" });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(pathname()).toBe("/actions");
    expect(
      screen.queryByRole("combobox", { name: t.commandSearch }),
    ).toBeNull();
  });
});

describe("record editing keys", () => {
  test("keyboard stage moves stay inside the deal's pipeline", async () => {
    const snapshot = await harness.service.snapshot(
      { userId: demoUser, source: "demo" },
      { organizationId: demoId(1) },
    );
    const deal = snapshot.opportunities.find(
      (item) => item.id === demoId(1100),
    );
    expect(deal).toBeTruthy();
    const stages = JSON.parse(JSON.stringify(snapshot.stages));
    const opportunity = JSON.parse(JSON.stringify(deal));
    const evaluation = stages.find(
      (stage: { id: string }) => stage.id === opportunity.stageId,
    );
    const other = {
      ...evaluation,
      id: "other-pipeline",
      pipelineId: "other-pipeline",
      position: 2,
    };
    expect(
      adjacentOpenStage([evaluation, other], opportunity, "next"),
    ).toMatchObject({ stage: undefined, reason: t.openStageEnd });
  });

  const card = (name: string) => screen.getByRole("button", { name });
  const column = (name: string, product = "AI Platform") => {
    const pipeline = screen
      .getByRole("heading", { name: `${product} / Sales pipeline`, level: 2 })
      .closest(".product-pipeline") as HTMLElement;
    return within(pipeline).getByRole("region", { name });
  };
  const changes = () =>
    harness.posts.filter((post) => post.operation === "opportunity-change") as {
      stageId?: string;
    }[];
  test("E edits the open person record and the save key stores it", async () => {
    binding("edit");
    await mountCrm(harness, `/people/${demoId(200)}`);
    (document.activeElement as HTMLElement | null)?.blur();
    await press("e");
    const dialog = screen.getByRole("dialog", { name: t.editPerson });
    const title = within(dialog).getByLabelText(t.roleTitle);
    await userEvent.setup().clear(title);
    await userEvent.setup().type(title, "Head of AI");
    await press("{Meta>}{Enter}{/Meta}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: t.editPerson })).toBeNull(),
    );
    expect(
      harness.posts.find((post) => post.operation === "person-update"),
    ).toMatchObject({ personId: demoId(200), title: "Head of AI" });
    await waitFor(() => expect(screen.getByText("Head of AI")).toBeTruthy());
  });
  test("Shift arrows move the focused deal through open stages, never into won, and Undo moves it back", async () => {
    binding("move-next");
    binding("move-previous");
    await mountCrm(harness, "/opportunities");
    const name = "Northstar evaluation project";
    card(name).focus();
    await press("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() =>
      expect(
        within(column("Proposal")).getByRole("button", { name }),
      ).toBeTruthy(),
    );
    await waitFor(() => expect(document.activeElement).toBe(card(name)));
    await press("{Shift>}{ArrowRight}{/Shift}");
    expect(await screen.findByText(t.openStageEnd)).toBeTruthy();
    expect(changes().map((post) => post.stageId)).toEqual([demoId(802)]);
    expect(
      within(column("Proposal")).getByRole("button", { name }),
    ).toBeTruthy();
    await press("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() =>
      expect(
        within(column("Evaluation")).getByRole("button", { name }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: t.undo }).at(-1) as HTMLElement,
    );
    await waitFor(() =>
      expect(
        within(column("Proposal")).getByRole("button", { name }),
      ).toBeTruthy(),
    );
    expect(changes().map((post) => post.stageId)).toEqual([
      demoId(802),
      demoId(801),
      demoId(802),
    ]);
  });
  test("a won deal does not move by arrow key, E edits the focused deal and a drag closes it", async () => {
    await mountCrm(harness, "/opportunities");
    const name = "Cedar workflow pilot";
    const article = card(name).closest("article") as HTMLElement;
    fireEvent.dragStart(article);
    fireEvent.dragOver(column("Won"));
    expect(column("Won").hasAttribute("data-drop-target")).toBe(false);
    fireEvent.drop(column("Won"));
    expect(changes()).toHaveLength(0);
    fireEvent.dragOver(column("Won", "Services"));
    expect(column("Won", "Services").hasAttribute("data-drop-target")).toBe(
      true,
    );
    fireEvent.drop(column("Won", "Services"));
    await waitFor(() =>
      expect(
        within(column("Won", "Services")).getByRole("button", { name }),
      ).toBeTruthy(),
    );
    expect(changes().map((post) => post.stageId)).toEqual([demoId(823)]);
    card(name).focus();
    await press("{Shift>}{ArrowLeft}{/Shift}");
    expect(await screen.findByText(t.closedStageMove)).toBeTruthy();
    expect(changes()).toHaveLength(1);
    card(name).focus();
    await press("e");
    const dialog = screen.getByRole("dialog", { name: t.editOpportunity });
    expect(
      (within(dialog).getByLabelText(t.stage) as HTMLSelectElement).value,
    ).toBe(demoId(823));
  });
  test("C creates a company that opens on its record, and C and E create and edit meetings", async () => {
    await mountCrm(harness, "/companies");
    await press("c");
    const company = screen.getByRole("dialog", { name: t.newCompany });
    await userEvent
      .setup()
      .type(within(company).getByLabelText(t.name), "Fictional Keyboard Co");
    await press("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(pathname()).toMatch(/^\/companies\/.+/));
    expect(
      await screen.findByRole("heading", { name: "Fictional Keyboard Co" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: t.meetings }));
    await waitFor(() => expect(pathname()).toBe("/meetings"));
    (document.activeElement as HTMLElement | null)?.blur();
    await press("c");
    expect(screen.getByRole("dialog", { name: t.newMeeting })).toBeTruthy();
    fireEvent(
      screen.getByRole("dialog", { name: t.newMeeting }),
      new Event("cancel"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: t.newMeeting })).toBeNull(),
    );
    screen.getByRole("button", { name: "Leena Rao" }).focus();
    await press("e");
    const meeting = screen.getByRole("dialog", { name: t.editMeeting });
    expect(
      (within(meeting).getByLabelText(t.meetingTitle) as HTMLInputElement)
        .value,
    ).toBe("Pilot scope discussion");
  });
});

function label(key: string) {
  const value = t[key as keyof typeof t];
  return typeof value === "string" ? value : key;
}

describe("the guide", () => {
  test("lists every registry entry with its label and every binding, and nothing else", () => {
    render(<Shortcuts onClose={() => {}} />);
    const listed = [...document.querySelectorAll("[data-shortcut]")];
    expect(listed.map((item) => item.getAttribute("data-shortcut"))).toEqual(
      shortcuts.map((entry) => entry.id),
    );
    for (const entry of shortcuts) {
      const item = document.querySelector(`[data-shortcut="${entry.id}"]`);
      expect(item?.textContent).toContain(entry.label);
      const keys = item?.querySelector(".shortcut-keys .sr-only")?.textContent;
      for (const value of entry.bindings)
        expect(keys).toContain(bindingLabel(value, false));
    }
  });
  test("every registry entry is exercised by a keyboard test in this file", () => {
    expect(
      shortcuts.map((entry) => entry.id).filter((id) => !covered.has(id)),
    ).toEqual([]);
  });
});
