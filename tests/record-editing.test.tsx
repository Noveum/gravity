// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { zonedInputValue as localInputValue } from "../packages/core/calendar";
import { RecordService } from "../packages/core/records";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { browserNavigation, requestJson } from "../src/components/client-api";
import { archiveRecord, contactTab } from "./support/contact-workspace";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const pathname = () => window.location.pathname;

describe("people", () => {
  test("contact fields are editable directly and each save persists on the record", async () => {
    await mountCrm(harness, `/people/${demoId(201)}`);
    await contactTab(t.contactWorkspace.details);
    const saveField = async (label: string, value: string) => {
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value } });
      const form = field.closest("form");
      if (!form) throw new Error("Missing inline form");
      fireEvent.submit(form);
      await waitFor(() =>
        expect(form.querySelector("[role=status]")).toBeTruthy(),
      );
      await waitFor(() =>
        expect(
          harness.posts
            .filter((post) => post.operation === "person-update")
            .at(-1),
        ).toMatchObject({
          version: harness.posts.filter(
            (post) => post.operation === "person-update",
          ).length,
        }),
      );
      await waitFor(() => expect(field).toHaveProperty("disabled", false));
    };
    await saveField(t.phone, "+1 555 0100");
    await saveField(
      t.linkedinUrl,
      "https://www.linkedin.com/in/fictional-jonah",
    );
    await saveField(t.otherEmails, "jonah@home.example.test");
    await saveField(t.company, demoId(102));
    const link = await screen.findByRole("link", { name: t.linkedinProfile });
    expect(link.getAttribute("href")).toBe(
      "https://www.linkedin.com/in/fictional-jonah",
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "+1 555 0100" })).toBeTruthy();
    const [stored] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(stored?.companyId).toBe(demoId(102));
    expect(stored?.otherEmails).toEqual(["jonah@home.example.test"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a refused inline edit retains the draft and explains the reason", async () => {
    await mountCrm(harness, `/people/${demoId(201)}`);
    await contactTab(t.contactWorkspace.details);
    const email = screen.getByLabelText(t.email);
    fireEvent.change(email, { target: { value: "person0@example.test" } });
    const form = email.closest("form");
    if (!form) throw new Error("Missing inline form");
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveProperty(
      "textContent",
      t.errors.PERSON_EXISTS,
    );
    expect(email).toHaveProperty("value", "person0@example.test");
  });

  test("archiving leaves the record for the list, hides the person and Undo restores them", async () => {
    await mountCrm(harness, "/people");
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    fireEvent.click(
      await screen.findByRole("link", { name: t.inlineEditing.openFullPage }),
    );
    expect(pathname()).toBe(`/people/${demoId(201)}`);
    await archiveRecord();
    fireEvent.click(
      screen.getByRole("button", { name: t.inlineEditing.confirmArchive }),
    );
    await waitFor(() => expect(pathname()).toBe("/people"));
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).queryByRole("link", {
          name: "Jonah Reed",
        }),
      ).toBeNull(),
    );
    expect(
      await screen.findByText(t.personArchived.replace("{name}", "Jonah Reed")),
    ).toBeTruthy();
    expect(screen.getByText(t.archivedRecords)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.undo }));
    expect(pathname()).toBe("/people");
    expect(
      await screen.findByRole("button", { name: t.contactWorkspace.more }),
    ).toBeTruthy();
    const [stored] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(stored?.archivedAt).toBeNull();
  });

  test("an archived person opens read-only from the archived list and restores in place", async () => {
    await mountCrm(harness, `/people/${demoId(204)}`);
    await archiveRecord();
    fireEvent.click(
      screen.getByRole("button", { name: t.inlineEditing.confirmArchive }),
    );
    await waitFor(() => expect(pathname()).toBe("/people"));
    fireEvent.click(await screen.findByText(t.archivedRecords));
    fireEvent.click(screen.getByRole("link", { name: "Amara Stone" }));
    expect(pathname()).toBe("/people");
    expect(await screen.findByText(t.archivedPersonNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.edit })).toBeNull();
    const restore = screen.getByRole("button", { name: t.restore });
    await waitFor(() => expect(restore).toHaveProperty("disabled", false));
    fireEvent.click(restore);
    expect(
      await screen.findByRole("button", { name: t.contactWorkspace.more }),
    ).toBeTruthy();
    expect(screen.queryByText(t.archivedPersonNote)).toBeNull();
  });
});

describe("fix round 1", () => {
  test("an archived company stays on the person, labelled archived, and an unchanged save keeps it", async () => {
    const records = new RecordService(harness.local.db);
    await records.archiveCompany(
      { userId: "demo-you", source: "demo" },
      {
        organizationId: demoId(1),
        companyId: demoId(105),
        version: 1,
        archived: true,
      },
    );
    await mountCrm(harness, `/people/${demoId(205)}`);
    const archivedName = `Vale Software ${t.archivedSuffix}`;
    expect(await screen.findAllByText(archivedName)).not.toHaveLength(0);
    await contactTab(t.contactWorkspace.details);
    const company = screen.getByLabelText(t.company) as HTMLSelectElement;
    expect(company.value).toBe(demoId(105));
    expect(company.selectedOptions[0]?.textContent).toBe(archivedName);
    await contactTab(t.contactWorkspace.details);
    const phone = screen.getByLabelText(t.phone);
    fireEvent.change(phone, { target: { value: "+1 555 0199" } });
    const form = phone.closest("form");
    if (!form) throw new Error("Missing inline form");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(form.querySelector("[role=status]")).toBeTruthy(),
    );
    const post = harness.posts.find(
      (body) => body.operation === "person-update",
    );
    expect(post).toBeTruthy();
    expect(post && "companyId" in post).toBe(false);
    const [stored] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(205)));
    expect(stored?.companyId).toBe(demoId(105));
  });

  test("meeting times are shown and saved in the workspace time zone", async () => {
    expect(localInputValue("2030-03-04T04:30:00.000Z", "Asia/Kolkata")).toBe(
      "2030-03-04T10:00",
    );
    await mountCrm(harness, "/meetings");
    screen.getByRole("button", { name: "Leena Rao" }).focus();
    await userEvent.setup().keyboard("e");
    const dialog = screen.getByRole("region", { name: t.editMeeting });
    const starts = within(dialog).getByLabelText(
      t.startsAt,
    ) as HTMLInputElement;
    const [meeting] = await harness.local.db
      .select()
      .from(s.meetings)
      .where(eq(s.meetings.id, demoId(1000)));
    expect(starts.value).toBe(
      localInputValue(meeting?.startsAt.toISOString() ?? "", "UTC"),
    );
    fireEvent.change(starts, { target: { value: "2030-05-06T07:45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(
        harness.posts.find((body) => body.operation === "meeting"),
      ).toMatchObject({ startsAt: "2030-05-06T07:45:00.000Z" }),
    );
  });

  test("deal values use the currency's minor units", async () => {
    await mountCrm(harness, "/opportunities");
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.setup().keyboard("c");
    const deal = screen.getByRole("region", { name: t.newOpportunity });
    const user = userEvent.setup();
    await user.selectOptions(
      within(deal).getByLabelText(t.person),
      "Jonah Reed · API Marketplace",
    );
    await user.type(within(deal).getByLabelText(t.name), "Fictional yen deal");
    const amount = within(deal).getByLabelText(t.amount);
    expect(amount.getAttribute("step")).toBe("0.01");
    const currency = within(deal).getByLabelText(t.currency);
    await user.clear(currency);
    await user.type(currency, "KWD");
    expect(amount.getAttribute("step")).toBe("0.001");
    await user.clear(currency);
    await user.type(currency, "JPY");
    expect(amount.getAttribute("step")).toBe("1");
    await user.type(amount, "1250");
    fireEvent.click(within(deal).getByRole("button", { name: t.create }));
    expect(
      await screen.findByRole("button", { name: "Fictional yen deal" }),
    ).toBeTruthy();
    expect(
      harness.posts.find((body) => body.operation === "deal"),
    ).toMatchObject({ amountMinor: 1250, currency: "JPY" });
    const card = screen
      .getByRole("button", { name: "Fictional yen deal" })
      .closest("tr") as HTMLElement;
    expect(card.textContent).toContain("¥1,250");
  });

  test("a save pressed while another change is in flight says to try again", async () => {
    await mountCrm(harness, `/people/${demoId(201)}`);
    await contactTab(t.contactWorkspace.details);
    const request = vi.mocked(requestJson);
    const respond = request.getMockImplementation();
    request.mockImplementation((url, init) =>
      init?.method === "POST"
        ? new Promise(() => {})
        : (respond?.(url, init) ?? Promise.resolve({})),
    );
    await archiveRecord();
    fireEvent.click(
      screen.getByRole("button", { name: t.inlineEditing.confirmArchive }),
    );
    await contactTab(t.contactWorkspace.details);
    const phone = screen.getByLabelText(t.phone);
    fireEvent.change(phone, { target: { value: "+1 555 0199" } });
    const form = phone.closest("form");
    if (!form) throw new Error("Missing inline form");
    fireEvent.submit(form);
    expect(await screen.findByText(t.stillSaving)).toBeTruthy();
  });
});

describe("the actions list", () => {
  test("an action due on an earlier calendar day is marked overdue even within 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T08:00:00Z"));
    try {
      const [action] = await harness.local.db
        .update(s.actions)
        .set({
          title: "Fictional late-night follow-up",
          dueAt: new Date("2026-10-04T23:00:00Z"),
        })
        .where(eq(s.actions.id, demoId(606)))
        .returning();
      expect(action).toBeTruthy();
      await mountCrm(harness, "/actions");
      const row = (
        await screen.findByText("Fictional late-night follow-up")
      ).closest("button");
      expect(
        row?.querySelector(".row-due")?.classList.contains("overdue"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("companies", () => {
  test("a company is edited and archived from its record, then restored from the archive", async () => {
    await mountCrm(harness, `/companies/${demoId(103)}`);
    const domain = screen.getByLabelText(t.domain);
    fireEvent.change(domain, {
      target: { value: "https://www.harbor.example.test/" },
    });
    const form = domain.closest("form");
    if (!form) throw new Error("Missing inline form");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(form.querySelector("[role=status]")).toBeTruthy(),
    );
    await archiveRecord();
    fireEvent.click(
      screen.getByRole("button", { name: t.inlineEditing.confirmArchive }),
    );
    await waitFor(() => expect(pathname()).toBe("/companies"));
    fireEvent.click(await screen.findByText(t.archivedRecords));
    fireEvent.click(screen.getByRole("link", { name: "Horizon Studio" }));
    expect(await screen.findByText(t.archivedCompanyNote)).toBeTruthy();
    const restore = screen.getByRole("button", { name: t.restore });
    await waitFor(() => expect(restore).toHaveProperty("disabled", false));
    fireEvent.click(restore);
    expect(
      await screen.findByRole("button", { name: t.contactWorkspace.more }),
    ).toBeTruthy();
  });
});

describe("meetings and opportunities", () => {
  test("a new meeting and a new opportunity are created through their dialogs", async () => {
    await mountCrm(harness, "/meetings");
    fireEvent.click(screen.getByRole("link", { name: t.meetings }));
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.setup().keyboard("c");
    const meeting = screen.getByRole("region", { name: t.newMeeting });
    const user = userEvent.setup();
    await user.selectOptions(
      within(meeting).getByLabelText(t.person),
      "Jonah Reed · API Marketplace",
    );
    await user.type(
      within(meeting).getByLabelText(t.meetingTitle),
      "Fictional API review",
    );
    fireEvent.change(within(meeting).getByLabelText(t.startsAt), {
      target: { value: "2030-03-04T10:00" },
    });
    fireEvent.click(within(meeting).getByRole("button", { name: t.create }));
    expect(
      await screen.findByRole("heading", { name: "Fictional API review" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: t.opportunities }));
    await waitFor(() => expect(pathname()).toBe("/opportunities"));
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.setup().keyboard("c");
    const deal = screen.getByRole("region", { name: t.newOpportunity });
    await user.selectOptions(
      within(deal).getByLabelText(t.person),
      "Jonah Reed · API Marketplace",
    );
    expect(
      [
        ...(within(deal).getByLabelText(t.stage) as HTMLSelectElement).options,
      ].map((option) => option.text),
    ).toEqual(["Discovery", "Evaluation", "Proposal", "Won", "Lost"]);
    await user.type(within(deal).getByLabelText(t.name), "Fictional API deal");
    await user.type(within(deal).getByLabelText(t.amount), "1250.50");
    fireEvent.click(within(deal).getByRole("button", { name: t.create }));
    expect(
      await screen.findByRole("button", { name: "Fictional API deal" }),
    ).toBeTruthy();
    expect(
      harness.posts.find((post) => post.operation === "deal"),
    ).toMatchObject({ amountMinor: 125050, currency: "USD" });
  });
});

describe("signing out", () => {
  test("the user menu signs out of the session and lands on sign-in", async () => {
    const assign = vi
      .spyOn(browserNavigation, "assign")
      .mockImplementation(() => {});
    await mountCrm(harness);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Account:/ }), {
      key: "Enter",
    });
    const menu = screen.getByRole("menu", { name: t.account });
    fireEvent.click(within(menu).getByRole("menuitem", { name: t.signOut }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"));
    assign.mockRestore();
  });
  test("outside demo mode the session is ended first, and a failure keeps the user signed in with a message", async () => {
    const { signOut } = await import("../src/components/shell/user-menu");
    const assign = vi
      .spyOn(browserNavigation, "assign")
      .mockImplementation(() => {});
    const request = vi.mocked(requestJson);
    request.mockResolvedValueOnce({ success: true });
    await signOut(false);
    expect(request).toHaveBeenLastCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({ method: "POST" }),
    );
    expect(assign).toHaveBeenCalledWith("/sign-in");
    assign.mockClear();
    request.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    await expect(signOut(false)).rejects.toThrow("NETWORK_ERROR");
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });
});

test("two dirty contact fields save in sequence without overwriting each other", async () => {
  await mountCrm(harness, `/people/${demoId(201)}`);
  const name = screen.getByRole("textbox", { name: t.name });
  const notes = screen.getByRole("textbox", {
    name: t.personNotes,
  });
  fireEvent.change(name, { target: { value: "Fictional updated name" } });
  fireEvent.change(notes, { target: { value: "My personal notes." } });
  const notesForm = notes.closest("form"),
    nameForm = name.closest("form");
  if (!notesForm || !nameForm) throw new Error("Missing contact fields");
  fireEvent.submit(notesForm);
  await waitFor(() =>
    expect(notesForm.querySelector("[role=status]")).toBeTruthy(),
  );
  fireEvent.submit(nameForm);
  await waitFor(() =>
    expect(nameForm.querySelector("[role=status]")).toBeTruthy(),
  );
  const [stored] = await harness.local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, demoId(201)));
  expect(stored).toMatchObject({
    name: "Fictional updated name",
    summary: "My personal notes.",
    version: 3,
  });
  expect(
    harness.posts
      .filter((post) => post.operation === "person-update")
      .map((post) => post.version),
  ).toEqual([1, 2]);
});
