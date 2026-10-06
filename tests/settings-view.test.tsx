// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { gmailSendScope } from "../packages/connectors/outbound-provider";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { settingsSections } from "../src/components/routes";
import { reopenWorkspace } from "../src/components/workspace-preference";
import {
  installSettingsHarness,
  lastCall,
  mountSettings,
} from "./support/settings-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
vi.mock("../src/components/workspace-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/components/workspace-preference")
  >()),
  reopenWorkspace: vi.fn(),
}));

const harness = installSettingsHarness();
afterEach(() => vi.mocked(reopenWorkspace).mockClear());
const member = "demo-teammate";
const panel = (section: keyof typeof t.settingsSections) =>
  screen.getByRole("region", { name: t.settingsSections[section] });

describe("settings shell", () => {
  test("every section is one link away and Connections no longer repeats the assistant card", async () => {
    await mountSettings(harness, "/settings/connections");
    const nav = screen.getByRole("navigation", { name: t.settingsNavigation });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual(
      settingsSections.map((section) => [
        t.settingsSections[section],
        `/settings/${section}`,
      ]),
    );
    expect(
      within(nav)
        .getByRole("link", { name: t.settingsSections.connections })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      await within(panel("connections")).findByRole("heading", {
        name: t.gmail,
      }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(t.mcpEndpoint)).toBeNull();
  });
});

describe("workspace settings", () => {
  test("a slug change keeps the selected product filter when the workspace reopens", async () => {
    await mountSettings(harness, "/settings/workspace", demoUser, demoId(11));
    const region = panel("workspace");
    fireEvent.change(within(region).getByLabelText(t.workspaceSlug), {
      target: { value: "northstar-filtered" },
    });
    fireEvent.click(within(region).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(reopenWorkspace).toHaveBeenCalledWith(
        demoId(1),
        "/settings/workspace",
        demoId(11),
      ),
    );
  });
  test("an admin saves the name, time zone, address and domains through update_organization and the workspace is reselected", async () => {
    await mountSettings(harness, "/settings/workspace");
    const region = panel("workspace");
    fireEvent.change(within(region).getByLabelText(t.workspaceName), {
      target: { value: "Northstar Studio" },
    });
    fireEvent.change(within(region).getByLabelText(t.organizationTimezone), {
      target: { value: "Europe/Berlin" },
    });
    fireEvent.change(within(region).getByLabelText(t.workspaceSlug), {
      target: { value: "northstar-studio" },
    });
    fireEvent.change(within(region).getByLabelText(t.allowedDomains), {
      target: { value: "Example.test\npartner.example.test" },
    });
    fireEvent.click(within(region).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(reopenWorkspace).toHaveBeenCalledWith(
        demoId(1),
        "/settings/workspace",
        "",
      ),
    );
    expect(lastCall(harness, "update_organization")?.body).toMatchObject({
      organizationId: demoId(1),
      name: "Northstar Studio",
      timezone: "Europe/Berlin",
      slug: "northstar-studio",
      allowedEmailDomains: ["Example.test", "partner.example.test"],
    });
    const [organization] = await harness.local.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, demoId(1)));
    expect(organization).toMatchObject({
      name: "Northstar Studio",
      slug: "northstar-studio",
      timezone: "Europe/Berlin",
      allowedEmailDomains: ["example.test", "partner.example.test"],
    });
  });

  test("saving without an address change only sends what changed and keeps the page", async () => {
    await mountSettings(harness, "/settings/workspace");
    const region = panel("workspace");
    fireEvent.change(within(region).getByLabelText(t.workspaceName), {
      target: { value: "Northstar Renamed" },
    });
    fireEvent.click(within(region).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(lastCall(harness, "update_organization")?.body).toEqual({
        operation: "organization-settings",
        organizationId: demoId(1),
        name: "Northstar Renamed",
      }),
    );
    expect(reopenWorkspace).not.toHaveBeenCalled();
  });

  test("a member sees the workspace read only with no way to save", async () => {
    await mountSettings(harness, "/settings/workspace", member);
    const region = panel("workspace");
    expect(
      (within(region).getByLabelText(t.workspaceName) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(within(region).queryByRole("button", { name: t.save })).toBeNull();
    expect(within(region).getByText(t.adminOnly)).toBeTruthy();
  });
});

describe("product settings", () => {
  const row = (name: string) =>
    within(panel("brands")).getByRole("listitem", { name });

  test("an admin renames, recolours, archives, restores and adds products through the product operations", async () => {
    await mountSettings(harness, "/settings/brands");
    fireEvent.change(
      within(row("Services")).getByLabelText(
        t.productNameFor.replace("{name}", "Services"),
      ),
      { target: { value: "Services Plus" } },
    );
    fireEvent.click(
      within(row("Services")).getByRole("button", { name: t.save }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_product")?.body).toMatchObject({
        productId: demoId(12),
        name: "Services Plus",
      }),
    );
    fireEvent.change(
      within(row("AI Platform")).getByLabelText(
        t.productColorFor.replace("{name}", "AI Platform"),
      ),
      { target: { value: "blue" } },
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_product")?.body).toMatchObject({
        productId: demoId(10),
        colorKey: "blue",
      }),
    );
    fireEvent.click(
      within(row("API Marketplace")).getByRole("button", { name: t.archive }),
    );
    fireEvent.click(
      within(row("API Marketplace")).getByRole("button", {
        name: t.archiveProductConfirm,
      }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "archive_product")?.body).toMatchObject({
        productId: demoId(11),
      }),
    );
    const restore = await within(row("API Marketplace")).findByRole("button", {
      name: t.restore,
    });
    fireEvent.click(restore);
    await waitFor(() =>
      expect(lastCall(harness, "restore_product")?.body).toMatchObject({
        productId: demoId(11),
      }),
    );
    fireEvent.change(within(panel("brands")).getByLabelText(t.productName), {
      target: { value: "Fixture Product" },
    });
    fireEvent.click(
      within(panel("brands")).getByRole("button", { name: t.newProduct }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "create_product")?.body).toMatchObject({
        name: "Fixture Product",
      }),
    );
    expect(
      await within(panel("brands")).findByRole("listitem", {
        name: "Fixture Product",
      }),
    ).toBeTruthy();
    const [renamed] = await harness.local.db
      .select()
      .from(s.products)
      .where(eq(s.products.id, demoId(12)));
    expect(renamed?.name).toBe("Services Plus");
  });

  test("a member sees products without any way to change them", async () => {
    await mountSettings(harness, "/settings/brands", member);
    expect(row("Services")).toBeTruthy();
    expect(within(panel("brands")).queryByRole("textbox")).toBeNull();
    expect(within(panel("brands")).queryByRole("button")).toBeNull();
    expect(within(panel("brands")).getByText(t.adminOnly)).toBeTruthy();
  });
});

describe("pipeline settings", () => {
  const group = (name: string) =>
    within(panel("pipelines")).getByRole("group", { name });
  const stageRow = (groupName: string, name: string) =>
    within(group(groupName)).getByRole("listitem", { name });
  const sales = "Sales pipeline";

  test("an admin renames, recategorises, reorders, archives and adds stages and pipelines through the stage operations", async () => {
    await mountSettings(harness, "/settings/pipelines");
    fireEvent.change(
      within(stageRow(sales, "Proposal")).getByLabelText(
        t.stageNameFor.replace("{name}", "Proposal"),
      ),
      { target: { value: "Offer" } },
    );
    fireEvent.click(
      within(stageRow(sales, "Proposal")).getByRole("button", { name: t.save }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_stage")?.body).toMatchObject({
        stageId: demoId(802),
        name: "Offer",
      }),
    );
    fireEvent.change(
      within(stageRow(t.outreachPipelineTitle, "Researching")).getByLabelText(
        t.stageCategoryFor.replace("{name}", "Researching"),
      ),
      { target: { value: "hold" } },
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_stage")?.body).toMatchObject({
        stageId: demoId(1201),
        category: "hold",
      }),
    );
    fireEvent.click(
      within(await waitFor(() => stageRow(sales, "Evaluation"))).getByRole(
        "button",
        { name: t.moveStageUp.replace("{name}", "Evaluation") },
      ),
    );
    await waitFor(() =>
      expect(lastCall(harness, "reorder_stages")?.body).toMatchObject({
        productId: demoId(10),
        pipeline: "deal",
        pipelineId: demoId(1210),
        stageIds: [
          demoId(801),
          demoId(800),
          demoId(802),
          demoId(803),
          demoId(804),
        ],
      }),
    );
    const offer = await waitFor(() => stageRow(sales, "Offer"));
    fireEvent.click(within(offer).getByRole("button", { name: t.archive }));
    fireEvent.change(
      within(offer).getByLabelText(
        t.archiveStageInto.replace("{name}", "Offer"),
      ),
      { target: { value: demoId(800) } },
    );
    fireEvent.click(
      within(offer).getByRole("button", { name: t.archiveStageConfirm }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "archive_stage")?.body).toMatchObject({
        stageId: demoId(802),
        moveToStageId: demoId(800),
      }),
    );
    fireEvent.change(
      within(group(sales)).getByLabelText(
        t.newStageIn.replace("{name}", sales),
      ),
      { target: { value: "Negotiation" } },
    );
    fireEvent.click(
      within(group(sales)).getByRole("button", { name: t.addStage }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "create_stage")?.body).toMatchObject({
        productId: demoId(10),
        pipeline: "deal",
        pipelineId: demoId(1210),
        name: "Negotiation",
        category: "open",
      }),
    );
    fireEvent.change(
      within(group(sales)).getByLabelText(
        t.pipelineNameFor.replace("{name}", sales),
      ),
      { target: { value: "New business" } },
    );
    fireEvent.click(
      within(group(sales)).getByRole("button", { name: t.renamePipeline }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_pipeline")?.body).toMatchObject({
        pipelineId: demoId(1210),
        name: "New business",
      }),
    );
    fireEvent.change(
      within(panel("pipelines")).getByLabelText(t.pipelineName),
      {
        target: { value: "Partnerships" },
      },
    );
    fireEvent.click(
      within(panel("pipelines")).getByRole("button", {
        name: t.createPipeline,
      }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "create_pipeline")?.body).toMatchObject({
        productId: demoId(10),
        name: "Partnerships",
      }),
    );
    expect(
      await within(panel("pipelines")).findByRole("group", {
        name: "Partnerships",
      }),
    ).toBeTruthy();
  });

  test("a member reads stages without controls", async () => {
    await mountSettings(harness, "/settings/pipelines", member);
    expect(stageRow(sales, "Proposal")).toBeTruthy();
    expect(within(panel("pipelines")).queryByRole("textbox")).toBeNull();
    expect(within(panel("pipelines")).queryByRole("button")).toBeNull();
    expect(within(panel("pipelines")).getByText(t.adminOnly)).toBeTruthy();
  });
});

describe("member settings", () => {
  const memberRow = (name: string) =>
    within(group(t.members)).getByRole("listitem", { name });
  const group = (name: string) =>
    within(panel("members")).getByRole("group", { name });
  const dialog = (name: string) => screen.getByRole("dialog", { name });

  test("an admin edits access in the member dialog, deactivates with reassignment and reactivates through the member operations", async () => {
    await mountSettings(harness, "/settings/members");
    const restricted = await waitFor(() => memberRow("Restricted member"));
    fireEvent.click(
      within(restricted).getByRole("button", {
        name: `${t.editMemberAccess}: Restricted member`,
      }),
    );
    const editing = dialog(t.editMemberAccess);
    fireEvent.click(
      within(editing).getByRole("checkbox", { name: "AI Platform" }),
    );
    fireEvent.click(
      within(editing).getByRole("button", { name: t.saveChanges }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_member_access")?.body).toMatchObject({
        userId: "demo-restricted",
        role: "member",
        productIds: expect.arrayContaining([demoId(10), demoId(11)]),
      }),
    );
    const sam = await waitFor(() => memberRow("Sam Rivera"));
    expect(within(sam).getByText("sam@example.test")).toBeTruthy();
    fireEvent.click(
      within(sam).getByRole("button", {
        name: `${t.editMemberAccess}: Sam Rivera`,
      }),
    );
    const promoting = dialog(t.editMemberAccess);
    fireEvent.keyDown(
      within(promoting).getByRole("combobox", { name: t.role }),
      {
        key: "Enter",
      },
    );
    fireEvent.click(await screen.findByRole("option", { name: t.admin }));
    fireEvent.click(
      within(promoting).getByRole("button", { name: t.saveChanges }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_member_access")?.body).toMatchObject({
        userId: member,
        role: "admin",
        productIds: [],
      }),
    );
    const again = await waitFor(() => memberRow("Restricted member"));
    fireEvent.click(
      within(again).getByRole("button", {
        name: `${t.deactivate}: Restricted member`,
      }),
    );
    expect(
      (
        within(again).getByLabelText(
          t.reassignWorkFrom.replace("{name}", "Restricted member"),
        ) as HTMLSelectElement
      ).value,
    ).toBe("demo-you");
    fireEvent.click(
      within(again).getByRole("button", { name: t.deactivateConfirm }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "remove_member")?.body).toMatchObject({
        operation: "member-remove",
        userId: "demo-restricted",
        reassignToUserId: "demo-you",
      }),
    );
    fireEvent.click(
      await waitFor(() =>
        within(memberRow("Restricted member")).getByRole("button", {
          name: `${t.reactivate}: Restricted member`,
        }),
      ),
    );
    await waitFor(() =>
      expect(lastCall(harness, "reactivate_member")?.body).toMatchObject({
        userId: "demo-restricted",
      }),
    );
  });

  test("deactivation offers only members who can take over the work and says why the others cannot", async () => {
    const [elsewhere] = await harness.local.db
      .select({ id: s.relationships.id })
      .from(s.relationships)
      .where(eq(s.relationships.productId, demoId(10)))
      .limit(1);
    if (!elsewhere) throw new Error("relationship fixture");
    await harness.local.db
      .update(s.relationships)
      .set({ ownerId: member })
      .where(eq(s.relationships.id, elsewhere.id));
    await mountSettings(harness, "/settings/members");
    const sam = await waitFor(() => memberRow("Sam Rivera"));
    fireEvent.click(
      within(sam).getByRole("button", { name: `${t.deactivate}: Sam Rivera` }),
    );
    const target = within(sam).getByLabelText(
      t.reassignWorkFrom.replace("{name}", "Sam Rivera"),
    ) as HTMLSelectElement;
    const options = Object.fromEntries(
      [...target.options].map((option) => [option.value, option]),
    );
    expect(target.value).toBe("demo-you");
    expect(options["demo-you"]?.disabled).toBe(false);
    expect(options["demo-restricted"]?.disabled).toBe(true);
    expect(options["demo-restricted"]?.textContent).toBe(
      t.reassignNeedsAccess
        .replace("{name}", "Restricted member")
        .replace("{products}", "AI Platform"),
    );
  });

  test("resending an invitation leaves out archived products and refuses when none is left", async () => {
    await harness.local.db.insert(s.invitations).values(
      [
        ["kept@example.test", [demoId(10), demoId(11)], "c1"],
        ["gone@example.test", [demoId(10)], "c2"],
      ].map(([email, productIds, hash]) => ({
        organizationId: demoId(1),
        email: email as string,
        role: "member" as const,
        productIds: productIds as string[],
        tokenHash: (hash as string).repeat(32),
        inviterId: demoUser,
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    );
    await harness.local.db
      .update(s.products)
      .set({ archivedAt: new Date() })
      .where(eq(s.products.id, demoId(10)));
    await mountSettings(harness, "/settings/members");
    const invitations = await waitFor(() => group(t.pendingInvitations));
    const resend = async (email: string) =>
      fireEvent.click(
        within(
          await within(invitations).findByRole("listitem", { name: email }),
        ).getByRole("button", { name: `${t.resendInvitation}: ${email}` }),
      );
    await resend("kept@example.test");
    await waitFor(() =>
      expect(lastCall(harness, "create_invitation")?.body).toMatchObject({
        email: "kept@example.test",
        productIds: [demoId(11)],
      }),
    );
    const created = harness.calls.length;
    await resend("gone@example.test");
    expect(await screen.findByText(t.resendInvitationArchived)).toBeTruthy();
    expect(harness.calls.length).toBe(created);
  });

  test("an admin invites from the dialog, resends by inviting again and revokes, sharing a fragment link", async () => {
    await mountSettings(harness, "/settings/members");
    fireEvent.click(
      within(panel("members")).getByRole("button", { name: t.inviteMember }),
    );
    const inviting = dialog(t.inviteMember);
    fireEvent.change(within(inviting).getByLabelText(t.emailAddress), {
      target: { value: "New.Person@example.test" },
    });
    for (const name of ["AI Platform", "API Marketplace"])
      fireEvent.click(within(inviting).getByRole("checkbox", { name }));
    fireEvent.click(
      within(inviting).getByRole("button", { name: t.createInvitation }),
    );
    const link = (await within(inviting).findByLabelText(
      t.invitationLink,
    )) as HTMLInputElement;
    expect(link.value).toMatch(/\/invite#[a-f0-9]{64}$/);
    expect(lastCall(harness, "create_invitation")?.body).toMatchObject({
      email: "New.Person@example.test",
      role: "member",
      productIds: [demoId(12)],
    });
    expect(within(inviting).getByText(t.invitationEmailOff)).toBeTruthy();
    fireEvent.click(within(inviting).getByRole("button", { name: t.close }));
    const invitations = await waitFor(() => group(t.pendingInvitations));
    const row = await within(invitations).findByRole("listitem", {
      name: "new.person@example.test",
    });
    fireEvent.click(
      within(row).getByRole("button", {
        name: `${t.resendInvitation}: new.person@example.test`,
      }),
    );
    await waitFor(() =>
      expect(
        harness.calls.filter((call) => call.operation === "create_invitation"),
      ).toHaveLength(2),
    );
    expect(lastCall(harness, "create_invitation")?.body).toMatchObject({
      email: "new.person@example.test",
      role: "member",
      productIds: [demoId(12)],
    });
    const resent = (await within(invitations).findByLabelText(
      t.invitationLink,
    )) as HTMLInputElement;
    expect(resent.value).not.toBe(link.value);
    fireEvent.click(
      within(
        await within(invitations).findByRole("listitem", {
          name: "new.person@example.test",
        }),
      ).getByRole("button", {
        name: `${t.revokeInvitation}: new.person@example.test`,
      }),
    );
    fireEvent.click(
      within(
        within(invitations).getByRole("listitem", {
          name: "new.person@example.test",
        }),
      ).getByRole("button", { name: t.revokeInvitationConfirm }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "revoke_invitation")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        within(invitations).queryByRole("listitem", {
          name: "new.person@example.test",
        }),
      ).toBeNull(),
    );
  });

  test("a member sees teammates but cannot change them or see invitations", async () => {
    await mountSettings(harness, "/settings/members", member);
    expect(await waitFor(() => memberRow("Alex Morgan"))).toBeTruthy();
    expect(within(panel("members")).queryByRole("combobox")).toBeNull();
    expect(within(panel("members")).queryByRole("button")).toBeNull();
    expect(
      within(panel("members")).queryByRole("group", {
        name: t.pendingInvitations,
      }),
    ).toBeNull();
    expect(within(panel("members")).getByText(t.adminOnly)).toBeTruthy();
  });
});

describe("outreach settings", () => {
  const region = () => panel("outreach");

  test("an admin saves contact rules through update_contact_rules and anyone with access manages do not contact", async () => {
    await mountSettings(harness, "/settings/outreach");
    const cooldown = (await within(region()).findByLabelText(
      t.cooldownDays,
    )) as HTMLInputElement;
    fireEvent.change(cooldown, { target: { value: "5" } });
    fireEvent.change(within(region()).getByLabelText(t.dailyCap), {
      target: { value: "40" },
    });
    fireEvent.change(within(region()).getByLabelText(t.quietHoursStart), {
      target: { value: "21" },
    });
    fireEvent.change(within(region()).getByLabelText(t.quietHoursEnd), {
      target: { value: "7" },
    });
    fireEvent.click(within(region()).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(lastCall(harness, "update_contact_rules")?.body).toMatchObject({
        version: 0,
        cooldownDays: 5,
        dailyCapPerSender: 40,
        quietHoursStart: 21,
        quietHoursEnd: 7,
      }),
    );
    fireEvent.change(within(region()).getByLabelText(t.choosePerson), {
      target: { value: demoId(200) },
    });
    fireEvent.click(
      within(region()).getByRole("button", { name: t.markDoNotContact }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "set_contact_preferences")?.body).toMatchObject({
        personId: demoId(200),
        doNotContact: true,
      }),
    );
    const listed = await within(region()).findByRole("listitem", {
      name: "Mira Chen",
    });
    const calls = harness.calls.length;
    fireEvent.click(
      within(listed).getByRole("button", { name: t.allowContact }),
    );
    const confirm = await within(listed).findByRole("button", {
      name: t.allowContactConfirm,
    });
    expect(harness.calls.length).toBe(calls);
    expect(within(listed).getByText(t.allowContactDetail)).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(lastCall(harness, "set_contact_preferences")?.body).toMatchObject({
        personId: demoId(200),
        doNotContact: false,
      }),
    );
  });

  test("a member reads the contact rules but cannot change them", async () => {
    await mountSettings(harness, "/settings/outreach", member);
    const cooldown = (await within(region()).findByLabelText(
      t.cooldownDays,
    )) as HTMLInputElement;
    expect(cooldown.disabled).toBe(true);
    expect(within(region()).queryByRole("button", { name: t.save })).toBeNull();
    expect(within(region()).getByText(t.adminOnly)).toBeTruthy();
    expect(
      within(region()).getByRole("button", { name: t.markDoNotContact }),
    ).toBeTruthy();
  });
});

describe("sending settings", () => {
  test("the owner sees which accounts can send and moves a connection to another product through update_connection", async () => {
    const [mailbox] = await harness.local.db
      .insert(s.connections)
      .values({
        organizationId: demoId(1),
        ownerId: "demo-you",
        provider: "gmail",
        productId: demoId(10),
        externalAccountId: "fixture-mailbox",
        displayName: "fixture@example.test",
        status: "connected",
        scopes: [gmailSendScope],
      })
      .returning();
    await harness.local.db.insert(s.connections).values({
      organizationId: demoId(1),
      ownerId: "demo-you",
      provider: "calendar",
      productId: demoId(11),
      externalAccountId: "fixture-calendar",
      displayName: "calendar@example.test",
      status: "connected",
    });
    await mountSettings(harness, "/settings/sending");
    const sending = await within(panel("sending")).findByRole("group", {
      name: t.sendingAccounts,
    });
    const row = await within(sending).findByRole("listitem", {
      name: "fixture@example.test",
    });
    expect(within(row).getByText(t.canSendBadge)).toBeTruthy();
    expect(
      within(panel("sending")).getByRole("listitem", {
        name: "calendar@example.test",
      }),
    ).toBeTruthy();
    fireEvent.change(
      within(row).getByLabelText(
        t.connectionProductFor.replace("{name}", "fixture@example.test"),
      ),
      { target: { value: demoId(11) } },
    );
    await waitFor(() =>
      expect(lastCall(harness, "update_connection")?.body).toMatchObject({
        connectionId: mailbox?.id,
        productId: demoId(11),
      }),
    );
    const [stored] = await harness.local.db
      .select()
      .from(s.connections)
      .where(eq(s.connections.id, mailbox?.id ?? ""));
    expect(stored?.productId).toBe(demoId(11));
  });

  test("a connection on an archived product shows that product's name as a disabled choice", async () => {
    await harness.local.db.insert(s.connections).values({
      organizationId: demoId(1),
      ownerId: "demo-you",
      provider: "gmail",
      productId: demoId(10),
      externalAccountId: "archived-mailbox",
      displayName: "archived@example.test",
      status: "connected",
      scopes: [gmailSendScope],
    });
    const [archived] = await harness.local.db
      .update(s.products)
      .set({ archivedAt: new Date() })
      .where(eq(s.products.id, demoId(10)))
      .returning();
    await mountSettings(harness, "/settings/sending");
    const row = await within(panel("sending")).findByRole("listitem", {
      name: "archived@example.test",
    });
    const select = within(row).getByLabelText(
      t.connectionProductFor.replace("{name}", "archived@example.test"),
    ) as HTMLSelectElement;
    const current = select.selectedOptions[0];
    expect(current?.textContent).toBe(archived?.name);
    expect(current?.disabled).toBe(true);
    expect(within(row).queryByText(t.unknown)).toBeNull();
  });

  test("a member without connections is pointed to Connections", async () => {
    await mountSettings(harness, "/settings/sending", member);
    expect(
      await within(panel("sending")).findByText(t.sendingEmpty),
    ).toBeTruthy();
    expect(within(panel("sending")).queryByRole("combobox")).toBeNull();
  });
});

describe("assistant settings", () => {
  test("an admin sees every assistant grant and revokes a teammate's", async () => {
    const [grant] = await harness.local.db
      .insert(s.mcpGrants)
      .values({
        organizationId: demoId(1),
        userId: member,
        productIds: ["*"],
      })
      .returning();
    await mountSettings(harness, "/settings/assistants");
    expect(
      within(panel("assistants")).getByLabelText(t.mcpEndpoint),
    ).toBeTruthy();
    const everyone = await within(panel("assistants")).findByRole("group", {
      name: t.workspaceGrants,
    });
    const row = await within(everyone).findByRole("listitem", {
      name: "Sam Rivera",
    });
    fireEvent.click(
      within(row).getByRole("button", {
        name: t.revokeFor.replace("{name}", "Sam Rivera"),
      }),
    );
    fireEvent.click(
      within(row).getByRole("button", { name: t.revokeGrantConfirm }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "revoke_assistant")?.body).toMatchObject({
        grantId: grant?.id,
      }),
    );
    const [stored] = await harness.local.db
      .select()
      .from(s.mcpGrants)
      .where(eq(s.mcpGrants.id, grant?.id ?? ""));
    expect(stored?.active).toBe(false);
    await waitFor(() =>
      expect(
        within(everyone).queryByRole("listitem", { name: "Sam Rivera" }),
      ).toBeNull(),
    );
  });

  test("a member manages only their own assistants", async () => {
    await mountSettings(harness, "/settings/assistants", member);
    expect(
      within(panel("assistants")).getByLabelText(t.mcpEndpoint),
    ).toBeTruthy();
    expect(
      within(panel("assistants")).queryByRole("group", {
        name: t.workspaceGrants,
      }),
    ).toBeNull();
  });
});
