// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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
