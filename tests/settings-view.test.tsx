// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
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

describe("workspace settings", () => {
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
