import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import {
  actionChangeSchema,
  actionPlanSchema,
  CrmService,
  personSchema,
  scheduleActionSchema,
} from "../../packages/core/crm";
import { type ClientSnapshot, serialize } from "../../packages/core/dto";
import { createLocalDatabase } from "../../packages/database/client";
import { demoId, demoUser, seedDemo } from "../../packages/database/seed";
import { requestJson } from "../../src/components/client-api";
import { CrmApp } from "../../src/components/crm-app";
import { CompanyRecord } from "../../src/components/records/company-record";
import { PersonRecord } from "../../src/components/records/person-record";
import { type Route, routeFor } from "../../src/components/routes";
import { ActionsView } from "../../src/components/views/actions-view";
import { CompaniesView } from "../../src/components/views/companies-view";
import { ConnectionsView } from "../../src/components/views/connections-view";
import { MaterialsView } from "../../src/components/views/materials-view";
import { MeetingsView } from "../../src/components/views/meetings-view";
import { OpportunitiesView } from "../../src/components/views/opportunities-view";
import { OutreachView } from "../../src/components/views/outreach-view";
import { PeopleView } from "../../src/components/views/people-view";
import { SequencesView } from "../../src/components/views/sequences-view";
import { SettingsView } from "../../src/components/views/settings-view";
import { usePathname, visit } from "./memory-router";

export const principal = { userId: demoUser, source: "demo" as const };
export const organizations = [
  {
    id: demoId(1),
    name: "Northstar Collective",
    slug: "northstar",
    timezone: "UTC",
  },
  { id: demoId(2), name: "Lunar Studio", slug: "lunar", timezone: "UTC" },
];

export interface Harness {
  local: Awaited<ReturnType<typeof createLocalDatabase>>;
  service: CrmService;
  posts: Record<string, unknown>[];
}

function page(route: Route | null): ReactNode {
  if (!route) return null;
  if (route.recordId)
    return route.section === "people" ? (
      <PersonRecord key={route.recordId} personId={route.recordId} />
    ) : (
      <CompanyRecord key={route.recordId} companyId={route.recordId} />
    );
  const views = {
    actions: ActionsView,
    people: PeopleView,
    companies: CompaniesView,
    sequences: SequencesView,
    meetings: MeetingsView,
    opportunities: OpportunitiesView,
    materials: MaterialsView,
    outreach: OutreachView,
    integrations: ConnectionsView,
    settings: SettingsView,
  };
  const View = views[route.section];
  return <View />;
}

function Routed() {
  return page(routeFor(usePathname()));
}

async function respond(harness: Harness, url: string, init?: RequestInit) {
  const { service } = harness;
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    harness.posts.push(body);
    if (body.operation === "plan")
      return serialize(
        await service.planActions(principal, actionPlanSchema.parse(body)),
      );
    if (body.operation === "action")
      return serialize(
        await service.changeAction(principal, actionChangeSchema.parse(body)),
      );
    if (body.operation === "schedule")
      return service.scheduleAction(
        principal,
        scheduleActionSchema.parse(body),
      );
    if (body.operation === "person")
      return service.createPerson(principal, personSchema.parse(body));
    throw new Error("UNSUPPORTED");
  }
  const params = new URL(url, "http://localhost").searchParams;
  const organizationId = params.get("organizationId") || demoId(1);
  if (params.get("operation") === "context")
    return serialize(
      await service.context(
        principal,
        organizationId,
        params.get("relationshipId") || "",
      ),
    );
  if (params.get("operation") === "company")
    return serialize(
      await service.companyContext(
        principal,
        { organizationId },
        params.get("companyId") || "",
      ),
    );
  return serialize(await service.snapshot(principal, { organizationId }));
}

export function installCrmHarness() {
  const harness = {} as Harness;
  const request = vi.mocked(requestJson);
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        static OPEN = 1;
        readyState = 1;
        onopen = null;
        onerror = null;
        close() {}
      },
    );
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
      this.querySelector<HTMLElement>("input,button:not(:disabled)")?.focus();
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  });
  beforeEach(async () => {
    harness.local = await createLocalDatabase();
    await seedDemo(harness.local.db);
    harness.service = new CrmService(harness.local.db);
    harness.posts = [];
    visit("/actions");
    localStorage.clear();
    document.documentElement.className = "";
    request.mockReset();
    request.mockImplementation((url, init) => respond(harness, url, init));
  });
  afterEach(async () => {
    cleanup();
    await harness.local.client.close();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  return harness;
}

export async function mountCrm(harness: Harness, path = "/actions") {
  visit(path);
  const snapshot: ClientSnapshot = serialize(
    await harness.service.snapshot(principal, { organizationId: demoId(1) }),
  );
  render(
    <CrmApp
      initial={snapshot}
      organizations={organizations}
      initialOrganizationId={demoId(1)}
      userId={demoUser}
      demo
    >
      <Routed />
    </CrmApp>,
  );
  await act(async () => {});
}
