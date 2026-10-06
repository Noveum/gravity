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
const members = () =>
  screen.getByRole("region", { name: t.settingsSections.members });

test("member settings lead with invitations, keep organization scope and leave workspace creation in the dropdown", async () => {
  await mountCrm(harness, "/settings/members");
  const settings = members();
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
  expect(await within(settings).findByText("Sam Rivera")).toBeTruthy();
  expect(
    within(settings).getAllByText(/AI Platform, API Marketplace, Services/)
      .length,
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

test("an invite uses explicit access, returns a shareable fragment link, appears as pending and can be revoked", async () => {
  await mountCrm(harness, "/settings/members");
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
  expect(link.value).toMatch(/\/invite#[a-f0-9]{64}$/);
  expect(
    harness.posts.filter((post) => post.operation === "invitation"),
  ).toEqual([
    expect.objectContaining({
      email: "new.teammate@example.test",
      role: "member",
      productIds: [demoId(10)],
    }),
  ]);
  expect(within(dialog).getByText(t.inviteShareDetail)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: t.close }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.revokeInvitation}: new.teammate@example.test`,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t.revokeInvitationConfirm }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: `${t.revokeInvitation}: new.teammate@example.test`,
      }),
    ).toBeNull(),
  );
});

test("invitation controls require product access and dropdowns stay within the modal", async () => {
  await mountCrm(harness, "/settings/members");
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

test("preferences save immediately and restore density", async () => {
  await mountCrm(harness, "/settings/preferences");
  fireEvent.keyDown(screen.getByRole("combobox", { name: t.density }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: t.comfortable }));
  expect(document.documentElement.dataset.density).toBe("comfortable");
  expect(localStorage.getItem("gravity-density")).toBe("comfortable");
});

test("keyboard help names the invite shortcut only on the members section", async () => {
  await mountCrm(harness, "/settings/members");
  fireEvent.click(screen.getByRole("button", { name: t.keyboardHelp }));
  const help = screen.getByRole("dialog", { name: t.keyboardHelp });
  expect(within(help).getByText(t.inviteMember)).toBeTruthy();
  expect(within(help).queryByText(t.shortcutLabels.save)).toBeNull();
  expect(within(help).queryByText(t.shortcutLabels.done)).toBeNull();
});

test("the command palette invites members from the members section", async () => {
  await mountCrm(harness, "/settings/members");
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
  expect(screen.getByRole("region", { name: t.newSequence })).toBeTruthy();
});

test("a refreshed snapshot updates pending invitations and organization details from another client", async () => {
  await mountCrm(harness, "/settings/members");
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
    await screen.findByText(
      "another.teammate@example.test",
      {},
      { timeout: 10000 },
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("link", { name: t.settingsSections.workspace }),
  );
  const workspace = await screen.findByRole("region", {
    name: t.settingsSections.workspace,
  });
  expect(
    (within(workspace).getByLabelText(t.workspaceName) as HTMLInputElement)
      .value,
  ).toBe("Updated Fictional Team");
  await waitFor(() =>
    expect(
      (
        within(workspace).getByLabelText(
          t.organizationTimezone,
        ) as HTMLSelectElement
      ).value,
    ).toBe("Asia/Tokyo"),
  );
});
