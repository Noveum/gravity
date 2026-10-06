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
  test("an admin saves the name, time zone, address and domains through update_workspace and the workspace is reselected", async () => {
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
    expect(lastCall(harness, "update_workspace")?.body).toMatchObject({
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
      expect(lastCall(harness, "update_workspace")?.body).toEqual({
        operation: "workspace-settings",
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

  test("an admin changes roles and product access, deactivates and reactivates members through the member operations", async () => {
    await mountSettings(harness, "/settings/members");
    const sam = await waitFor(() => memberRow("Sam Rivera"));
    expect(within(sam).getByText("sam@example.test")).toBeTruthy();
    fireEvent.change(
      within(sam).getByLabelText(
        t.memberRoleFor.replace("{name}", "Sam Rivera"),
      ),
      { target: { value: "admin" } },
    );
    await waitFor(() =>
      expect(lastCall(harness, "change_member_role")?.body).toMatchObject({
        userId: member,
        role: "admin",
      }),
    );
    const restricted = memberRow("Restricted member");
    fireEvent.click(within(restricted).getByText(t.productCountOne));
    fireEvent.click(within(restricted).getByLabelText("AI Platform"));
    fireEvent.click(
      within(restricted).getByRole("button", { name: t.saveAccess }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "set_member_products")?.body).toMatchObject({
        userId: "demo-restricted",
        productIds: expect.arrayContaining([demoId(10), demoId(11)]),
      }),
    );
    const again = await waitFor(() => memberRow("Restricted member"));
    fireEvent.click(within(again).getByRole("button", { name: t.deactivate }));
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
      expect(lastCall(harness, "deactivate_member")?.body).toMatchObject({
        userId: "demo-restricted",
        reassignToUserId: "demo-you",
      }),
    );
    fireEvent.click(
      await waitFor(() =>
        within(memberRow("Restricted member")).getByRole("button", {
          name: t.reactivate,
        }),
      ),
    );
    await waitFor(() =>
      expect(lastCall(harness, "reactivate_member")?.body).toMatchObject({
        userId: "demo-restricted",
      }),
    );
  });

  test("an admin invites, resends and revokes through the invitation operations and gets a link to share", async () => {
    await mountSettings(harness, "/settings/members");
    const invitations = await waitFor(() => group(t.invitations));
    fireEvent.change(within(invitations).getByLabelText(t.inviteEmail), {
      target: { value: "New.Person@example.test" },
    });
    fireEvent.click(within(invitations).getByLabelText("Services"));
    fireEvent.click(
      within(invitations).getByRole("button", { name: t.invite }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "create_invitation")?.body).toMatchObject({
        email: "New.Person@example.test",
        role: "member",
        productIds: [demoId(12)],
      }),
    );
    const link = (await within(invitations).findByLabelText(
      t.invitationLink,
    )) as HTMLInputElement;
    expect(link.value).toContain("/invite#");
    const row = await within(invitations).findByRole("listitem", {
      name: "new.person@example.test",
    });
    fireEvent.click(
      within(row).getByRole("button", { name: t.resendInvitation }),
    );
    await waitFor(() =>
      expect(lastCall(harness, "resend_invitation")).toBeTruthy(),
    );
    fireEvent.click(
      within(
        await within(invitations).findByRole("listitem", {
          name: "new.person@example.test",
        }),
      ).getByRole("button", { name: t.revokeInvitation }),
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
  });

  test("a member sees teammates but cannot change them or see invitations", async () => {
    await mountSettings(harness, "/settings/members", member);
    expect(await waitFor(() => memberRow("Alex Morgan"))).toBeTruthy();
    expect(within(panel("members")).queryByRole("combobox")).toBeNull();
    expect(within(panel("members")).queryByRole("button")).toBeNull();
    expect(
      within(panel("members")).queryByRole("group", { name: t.invitations }),
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
    fireEvent.click(
      within(listed).getByRole("button", { name: t.allowContact }),
    );
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
