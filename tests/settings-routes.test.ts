import { isValidElement, type ReactElement } from "react";
import { describe, expect, test } from "vitest";
import {
  appPath,
  legacyDestination,
  routeFor,
  type SettingsSection,
  sectionPath,
  settingsPath,
  settingsSectionFor,
  settingsSections,
} from "../src/components/routes";

const componentName = (element: unknown) => {
  if (!isValidElement(element)) return "";
  const type = (element as ReactElement).type;
  return typeof type === "function" ? type.name : "";
};
const redirectTarget = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    return digest.split(";")[2] ?? (error as Error).message;
  }
  return "";
};

describe("settings routes", () => {
  test("every settings section has its own URL that parses back to Settings", () => {
    expect(settingsSections).toEqual([
      "workspace",
      "brands",
      "pipelines",
      "members",
      "outreach",
      "connections",
      "sending",
      "assistants",
      "preferences",
    ]);
    for (const section of settingsSections) {
      expect(settingsPath(section)).toBe(`/settings/${section}`);
      expect(routeFor(settingsPath(section))).toEqual({
        section: "settings",
        recordId: "",
      });
      expect(settingsSectionFor(settingsPath(section))).toBe(section);
      expect(appPath(settingsPath(section))).toBe(settingsPath(section));
    }
    for (const unknown of [
      "/settings/nowhere",
      "/settings/members/extra",
      "/connections",
      "/assistants",
    ])
      expect(routeFor(unknown)).toBeNull();
    expect(settingsSectionFor("/settings")).toBe("workspace");
    expect(settingsSectionFor("/actions")).toBeNull();
  });

  test("Connections, MCP access and Settings open their settings sections", () => {
    const expected: Record<string, SettingsSection> = {
      integrations: "connections",
      assistants: "assistants",
      settings: "workspace",
    };
    for (const [section, target] of Object.entries(expected))
      expect(sectionPath(section as "integrations")).toBe(settingsPath(target));
    expect(
      legacyDestination({ view: "connections", integration: "connected" }),
    ).toBe("/settings/connections?integration=connected");
  });

  test("each settings section page renders the settings view and unknown sections are not found", async () => {
    const page = await import("../src/app/(crm)/settings/[section]/page");
    for (const section of settingsSections) {
      const element = await page.default({
        params: Promise.resolve({ section }),
      });
      expect(componentName(element)).toBe("SettingsView");
      expect(
        (await page.generateMetadata({ params: Promise.resolve({ section }) }))
          .title,
      ).toContain("·");
    }
    await expect(
      page.default({ params: Promise.resolve({ section: "nowhere" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  test("the old Settings, Connections and MCP access URLs redirect to their sections and keep connection notices", async () => {
    const settings = await import("../src/app/(crm)/settings/page");
    expect(await redirectTarget(() => settings.default())).toBe(
      "/settings/workspace",
    );
    const connections = await import("../src/app/(crm)/connections/page");
    expect(
      await redirectTarget(() =>
        connections.default({
          searchParams: Promise.resolve({
            integration: "connected",
            integrationError: ["A", "B"],
          }),
        }),
      ),
    ).toBe("/settings/connections?integration=connected");
    const assistants = await import("../src/app/(crm)/assistants/page");
    expect(await redirectTarget(() => assistants.default())).toBe(
      "/settings/assistants",
    );
  });
});
