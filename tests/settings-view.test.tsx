// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { OrganizationSettingsService } from "../packages/core/organization-settings";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("settings lead with invitations, keep organization scope and leave workspace creation in the dropdown", async () => {
  await mountCrm(harness, "/settings");
  const settings = screen.getByRole("region", { name: t.settings });
  expect(
    within(settings).getByRole("button", { name: t.inviteMember }),
  ).toBeTruthy();
  expect(
    within(settings).queryByRole("link", { name: t.createWorkspace }),
  ).toBeNull();
  expect(
    within(settings).queryByRole("button", { name: t.newOrganization }),
  ).toBeNull();
  expect(
    await within(settings).findByText(t.noPendingInvitations),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "AI Platform" }));
  expect(within(settings).getByText("Sam Rivera")).toBeTruthy();
  expect(
    within(settings).getByText("API Marketplace", { selector: "strong" }),
  ).toBeTruthy();
  expect(
    within(settings).getAllByText(
      /API Marketplace, Services|AI Platform, API Marketplace, Services/,
    ).length,
  ).toBeGreaterThan(0);
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
    { key: "Enter" },
  );
  expect(
    await screen.findByRole("menuitem", { name: t.createWorkspace }),
  ).toBeTruthy();
});

test("an invite uses explicit access, returns a shareable link, appears as pending and can be revoked", async () => {
  await mountCrm(harness, "/settings");
  fireEvent.click(screen.getByRole("button", { name: t.inviteMember }));
  const dialog = screen.getByRole("dialog", { name: t.inviteMember });
  fireEvent.change(within(dialog).getByLabelText(t.emailAddress), {
    target: { value: "new.teammate@example.test" },
  });
  for (const name of ["API Marketplace", "Services"])
    fireEvent.click(within(dialog).getByRole("checkbox", { name }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: t.createInvitation }),
  );
  const link = (await within(dialog).findByLabelText(
    t.invitationLink,
  )) as HTMLInputElement;
  expect(link.value).toMatch(/\/invite\/[a-f0-9]{64}$/);
  expect(
    harness.posts.filter((post) => post.operation === "invitation"),
  ).toEqual([
    expect.objectContaining({
      email: "new.teammate@example.test",
      role: "member",
      productIds: ["00000000-0000-4000-8000-000000000010"],
    }),
  ]);
  expect(within(dialog).getByText(t.inviteShareDetail)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: t.close }));
  const revoke = await screen.findByRole("button", {
    name: `${t.revokeInvitation}: new.teammate@example.test`,
  });
  fireEvent.click(revoke);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: `${t.revokeInvitation}: new.teammate@example.test`,
      }),
    ).toBeNull(),
  );
});

test("invitation controls require product access and dropdowns stay within the modal", async () => {
  await mountCrm(harness, "/settings");
  fireEvent.click(screen.getByRole("button", { name: t.inviteMember }));
  const dialog = screen.getByRole("dialog", { name: t.inviteMember });
  for (const checkbox of within(dialog).getAllByRole("checkbox"))
    fireEvent.click(checkbox);
  expect(
    (
      within(dialog).getByRole("button", {
        name: t.createInvitation,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: t.role }), {
    key: "Enter",
  });
  expect(dialog.contains(await screen.findByRole("listbox"))).toBe(true);
  fireEvent.click(screen.getByRole("option", { name: t.admin }));
  expect(within(dialog).queryByRole("checkbox")).toBeNull();
  expect(within(dialog).getByText(t.adminAccessDetail)).toBeTruthy();
  expect(
    (
      within(dialog).getByRole("button", {
        name: t.createInvitation,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("preferences save immediately, restore density and show only relevant settings shortcuts", async () => {
  await mountCrm(harness, "/settings");
  fireEvent.keyDown(screen.getByRole("combobox", { name: t.density }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: t.comfortable }));
  expect(document.documentElement.dataset.density).toBe("comfortable");
  expect(localStorage.getItem("gravity-density")).toBe("comfortable");
  fireEvent.click(screen.getByRole("button", { name: t.keyboardHelp }));
  const help = screen.getByRole("dialog", { name: t.keyboardHelp });
  expect(within(help).getByText(t.inviteMember)).toBeTruthy();
  expect(within(help).queryByText(t.shortcutLabels.save)).toBeNull();
  expect(within(help).queryByText(t.shortcutLabels.done)).toBeNull();
});

test("the command palette invites members from settings", async () => {
  await mountCrm(harness, "/settings");
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  const commands = screen.getByRole("dialog", { name: t.commands });
  const invite = within(commands).getByRole("option", {
    name: `${t.inviteMember}C`,
  });
  fireEvent.click(invite);
  expect(screen.getByRole("dialog", { name: t.inviteMember })).toBeTruthy();
});

test("the sequence command keeps its C hint while the person command has none", async () => {
  await mountCrm(harness, "/outreach/sequences");
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  const commands = screen.getByRole("dialog", { name: t.commands });
  expect(
    within(commands).getByRole("option", { name: t.addPerson }),
  ).toBeTruthy();
  fireEvent.click(
    within(commands).getByRole("option", { name: `${t.newSequence}C` }),
  );
  expect(screen.getByRole("dialog", { name: t.newSequence })).toBeTruthy();
});

test("a refreshed snapshot updates organization details and pending invitations from another client", async () => {
  await mountCrm(harness, "/settings");
  await screen.findByText(t.noPendingInvitations);
  const service = new OrganizationSettingsService(harness.local.db);
  const principal = { userId: demoUser, source: "demo" as const };
  await service.updateOrganization(principal, {
    organizationId: demoId(1),
    name: "Updated Fictional Team",
    timezone: "Asia/Tokyo",
  });
  await service.invite(principal, {
    organizationId: demoId(1),
    email: "another.teammate@example.test",
    role: "member",
    productIds: [demoId(10)],
  });
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  fireEvent.click(screen.getByRole("option", { name: t.refresh }));
  expect(
    await screen.findByRole("heading", {
      name: "Updated Fictional Team",
      level: 2,
    }),
  ).toBeTruthy();
  expect((screen.getByLabelText(t.timezone) as HTMLInputElement).value).toBe(
    "Asia/Tokyo",
  );
  expect(await screen.findByText("another.teammate@example.test")).toBeTruthy();
});
