import { existsSync } from "node:fs";
import { isValidElement, type ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Principal } from "../packages/core/policy";
import type { Database } from "../packages/database/client";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  actionFilters,
  actionsPath,
  personPath,
  routeFor,
  type Section,
  sectionPath,
} from "../src/components/routes";
import {
  brandCookie,
  chooseBrand,
  chooseWorkspace,
  preferenceCookie,
  workspaceCookie,
} from "../src/components/workspace-preference";

let db: Database;
let requestCookies = new Map<string, string>();
vi.mock("@crm/database/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: async () => db,
  isDemoMode: () => true,
}));
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: async (): Promise<Principal> => ({
    userId: demoUser,
    source: "demo",
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      requestCookies.has(name)
        ? { name, value: requestCookies.get(name) }
        : undefined,
  }),
}));

let local: Awaited<
  ReturnType<
    typeof import("../packages/database/client")["createLocalDatabase"]
  >
>;
beforeAll(async () => {
  const module = await vi.importActual<
    typeof import("../packages/database/client")
  >("../packages/database/client");
  local = await module.createLocalDatabase();
  db = local.db;
  await seedDemo(db);
});
afterAll(async () => {
  await local.client.close();
});

const listPages: Record<Section, [string, string]> = {
  actions: ["actions", "ActionsView"],
  people: ["people", "PeopleView"],
  companies: ["companies", "CompaniesView"],
  sequences: ["sequences", "SequencesView"],
  meetings: ["meetings", "MeetingsView"],
  opportunities: ["opportunities", "OpportunitiesView"],
  materials: ["materials", "MaterialsView"],
  outreach: ["outreach", "OutreachView"],
  integrations: ["connections", "ConnectionsView"],
  settings: ["settings", "SettingsView"],
};
const componentName = (element: unknown) => {
  if (!isValidElement(element)) return "";
  const type = (element as ReactElement).type;
  return typeof type === "function" ? type.name : "";
};

describe("route table", () => {
  test("every view and record has a path that parses back to it", () => {
    for (const section of Object.keys(listPages) as Section[])
      expect(routeFor(sectionPath(section))).toEqual({
        section,
        recordId: "",
      });
    expect(sectionPath("integrations")).toBe("/connections");
    expect(routeFor("/people/abc")).toEqual({
      section: "people",
      recordId: "abc",
    });
    expect(routeFor("/companies/abc/")).toEqual({
      section: "companies",
      recordId: "abc",
    });
    expect(routeFor(personPath("p 1"))).toEqual({
      section: "people",
      recordId: "p 1",
    });
    expect(personPath("p1", { relationshipId: "r", actionId: "a" })).toBe(
      "/people/p1?relationship=r&action=a",
    );
    for (const unknown of [
      "/",
      "/nowhere",
      "/meetings/abc",
      "/people/abc/extra",
      "/people/%E0%A4%A",
    ])
      expect(routeFor(unknown)).toBeNull();
  });

  test("action filters round-trip through the query string", () => {
    const href = actionsPath({ kind: "reply", owner: "u1", waiting: true });
    expect(href).toBe("/actions?kind=reply&owner=u1&waiting=1");
    expect(
      actionFilters(new URLSearchParams(href.split("?")[1] ?? "")),
    ).toEqual({ kind: "reply", owner: "u1", waiting: true });
    expect(actionsPath()).toBe("/actions");
  });

  test("each route has a page file that renders its view", async () => {
    for (const [folder, name] of Object.values(listPages)) {
      const path = `src/app/(crm)/${folder}/page.tsx`;
      expect(existsSync(path), path).toBe(true);
      const page = (await import(`../src/app/(crm)/${folder}/page.tsx`)) as {
        default: () => unknown;
      };
      expect(componentName(page.default()), path).toBe(name);
    }
    const person = await import("../src/app/(crm)/people/[id]/page");
    const personPage = await person.default({
      params: Promise.resolve({ id: demoId(200) }),
    });
    expect(componentName(personPage)).toBe("PersonRecord");
    expect(personPage.props.personId).toBe(demoId(200));
    const company = await import("../src/app/(crm)/companies/[id]/page");
    const companyPage = await company.default({
      params: Promise.resolve({ id: demoId(100) }),
    });
    expect(componentName(companyPage)).toBe("CompanyRecord");
    expect(companyPage.props.companyId).toBe(demoId(100));
  });

  test("the root redirects to actions and hands workspace links to the cookie route", async () => {
    const { default: Root } = await import("../src/app/page");
    const digest = async (query: Record<string, string>) => {
      try {
        await Root({ searchParams: Promise.resolve(query) });
      } catch (error) {
        return (error as { digest?: string }).digest ?? "";
      }
      return "";
    };
    expect(await digest({})).toContain(";/actions;");
    const link = await digest({
      organizationId: demoId(2),
      productId: demoId(13),
    });
    const target = new URL(link.split(";")[2] ?? "", "http://localhost");
    expect(target.pathname).toBe("/api/workspace");
    expect(target.searchParams.get("organizationId")).toBe(demoId(2));
    expect(target.searchParams.get("productId")).toBe(demoId(13));
    expect(target.searchParams.get("next")).toBe("/actions");
  });
});

describe("workspace preference", () => {
  const organizations = [
    { id: "o1", slug: "northstar" },
    { id: "o2", slug: "lunar" },
  ];
  test("the cookie slug picks the workspace and falls back safely", () => {
    expect(chooseWorkspace(organizations, "lunar", "o1")?.id).toBe("o2");
    expect(chooseWorkspace(organizations, "missing", "o1")?.id).toBe("o1");
    expect(chooseWorkspace(organizations, undefined, "")?.id).toBe("o1");
    expect(chooseWorkspace([], "lunar")).toBeUndefined();
    expect(chooseBrand([{ id: "p1" }], "p1")).toBe("p1");
    expect(chooseBrand([{ id: "p1" }], "p9")).toBe("");
  });
  test("cookies are path wide, lax, long lived and cleared when empty", () => {
    expect(preferenceCookie(workspaceCookie, "lunar", true)).toBe(
      "gravity-workspace=lunar; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(preferenceCookie(brandCookie, "")).toBe(
      "gravity-brand=; Path=/; Max-Age=0; SameSite=Lax",
    );
  });
  test("a reload renders the workspace and brand remembered in cookies", async () => {
    const { default: Layout } = await import("../src/app/(crm)/layout");
    requestCookies = new Map([
      [workspaceCookie, "lunar"],
      [brandCookie, demoId(13)],
    ]);
    const lunar = await Layout({ children: null });
    expect(lunar.props.initialOrganizationId).toBe(demoId(2));
    expect(lunar.props.initialProductId).toBe(demoId(13));
    expect(
      lunar.props.initial.products.map((p: { id: string }) => p.id),
    ).toEqual([demoId(13)]);
    requestCookies = new Map([[brandCookie, demoId(13)]]);
    const fallback = await Layout({ children: null });
    expect(fallback.props.initialOrganizationId).toBe(demoId(1));
    expect(fallback.props.initialProductId).toBe("");
  });
});
