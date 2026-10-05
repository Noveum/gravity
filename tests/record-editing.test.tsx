// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { browserNavigation } from "../src/components/shell/user-menu";
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
  test("the edit dialog saves contact fields that show on the record", async () => {
    await mountCrm(harness, `/people/${demoId(201)}`);
    fireEvent.click(screen.getByRole("button", { name: t.edit }));
    const dialog = screen.getByRole("dialog", { name: t.editPerson });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText(t.phone), "+1 555 0100");
    await user.type(
      within(dialog).getByLabelText(t.linkedinUrl),
      "https://www.linkedin.com/in/fictional-jonah",
    );
    await user.type(
      within(dialog).getByLabelText(t.otherEmails),
      "jonah@home.example.test",
    );
    await user.selectOptions(
      within(dialog).getByLabelText(t.company),
      "Cedar Systems",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: t.editPerson })).toBeNull(),
    );
    const link = await screen.findByRole("link", { name: t.linkedinProfile });
    expect(link.getAttribute("href")).toBe(
      "https://www.linkedin.com/in/fictional-jonah",
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "+1 555 0100" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "jonah@home.example.test" }),
    ).toBeTruthy();
    const [stored] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(stored?.companyId).toBe(demoId(102));
  });

  test("a refused edit keeps the dialog open with the reason", async () => {
    await mountCrm(harness, `/people/${demoId(201)}`);
    fireEvent.click(screen.getByRole("button", { name: t.edit }));
    const dialog = screen.getByRole("dialog", { name: t.editPerson });
    const email = within(dialog).getByLabelText(t.email);
    await userEvent.setup().clear(email);
    await userEvent.setup().type(email, "person0@example.test");
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    const reason = await within(dialog).findByText(t.errors.PERSON_EXISTS);
    expect(reason.getAttribute("role")).toBe("alert");
    expect(screen.getByRole("dialog", { name: t.editPerson })).toBeTruthy();
  });

  test("archiving leaves the record for the list, hides the person and Undo restores them", async () => {
    await mountCrm(harness, "/people");
    fireEvent.click(screen.getByRole("link", { name: "Jonah Reed" }));
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(201)}`));
    fireEvent.click(await screen.findByRole("button", { name: t.archive }));
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
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(201)}`));
    expect(await screen.findByRole("button", { name: t.archive })).toBeTruthy();
    const [stored] = await harness.local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(201)));
    expect(stored?.archivedAt).toBeNull();
  });

  test("an archived person opens read-only from the archived list and restores in place", async () => {
    await mountCrm(harness, `/people/${demoId(204)}`);
    fireEvent.click(await screen.findByRole("button", { name: t.archive }));
    await waitFor(() => expect(pathname()).toBe("/people"));
    fireEvent.click(await screen.findByText(t.archivedRecords));
    fireEvent.click(screen.getByRole("link", { name: "Amara Stone" }));
    await waitFor(() => expect(pathname()).toBe(`/people/${demoId(204)}`));
    expect(await screen.findByText(t.archivedPersonNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.edit })).toBeNull();
    const restore = screen.getByRole("button", { name: t.restore });
    await waitFor(() => expect(restore).toHaveProperty("disabled", false));
    fireEvent.click(restore);
    expect(await screen.findByRole("button", { name: t.archive })).toBeTruthy();
    expect(screen.queryByText(t.archivedPersonNote)).toBeNull();
  });
});

describe("companies", () => {
  test("a company is edited and archived from its record, then restored from the archive", async () => {
    await mountCrm(harness, `/companies/${demoId(103)}`);
    fireEvent.click(await screen.findByRole("button", { name: t.edit }));
    const dialog = screen.getByRole("dialog", { name: t.editCompany });
    const domain = within(dialog).getByLabelText(t.domain);
    await userEvent.setup().clear(domain);
    await userEvent.setup().type(domain, "https://www.harbor.example.test/");
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    expect(await screen.findByText("harbor.example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.archive }));
    await waitFor(() => expect(pathname()).toBe("/companies"));
    fireEvent.click(await screen.findByText(t.archivedRecords));
    fireEvent.click(screen.getByRole("link", { name: "Horizon Studio" }));
    expect(await screen.findByText(t.archivedCompanyNote)).toBeTruthy();
    const restore = screen.getByRole("button", { name: t.restore });
    await waitFor(() => expect(restore).toHaveProperty("disabled", false));
    fireEvent.click(restore);
    expect(await screen.findByRole("button", { name: t.archive })).toBeTruthy();
  });
});

describe("meetings and opportunities", () => {
  test("a new meeting and a new opportunity are created through their dialogs", async () => {
    await mountCrm(harness, "/meetings");
    fireEvent.click(screen.getByRole("link", { name: t.meetings }));
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.setup().keyboard("c");
    const meeting = screen.getByRole("dialog", { name: t.newMeeting });
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
    const deal = screen.getByRole("dialog", { name: t.newOpportunity });
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
      harness.posts.find((post) => post.operation === "opportunity"),
    ).toMatchObject({ amountMinor: 125050, currency: "USD" });
  });
});

describe("signing out", () => {
  test("the user menu signs out of the session and lands on sign-in", async () => {
    const assign = vi
      .spyOn(browserNavigation, "assign")
      .mockImplementation(() => {});
    await mountCrm(harness);
    fireEvent.click(screen.getByRole("button", { name: /^Account:/ }));
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
