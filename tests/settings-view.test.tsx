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
