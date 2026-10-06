import { act, cleanup, render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import {
  actionChangeSchema,
  actionPlanSchema,
  CrmService,
  opportunitySchema,
  personSchema,
  scheduleActionSchema,
} from "../../packages/core/crm";
import { type ClientSnapshot, serialize } from "../../packages/core/dto";
import {
  enrollmentChangeSchema,
  enrollSchema,
  OutreachService,
  relationshipChangeSchema,
  sequenceCreateSchema,
  sequenceUpdateSchema,
  touchApproveSchema,
  touchDraftSchema,
  touchQuerySchema,
  touchReopenSchema,
  touchSentSchema,
  touchSkipSchema,
  touchSnoozeSchema,
} from "../../packages/core/outreach";
import { DomainError } from "../../packages/core/policy";
import {
  companyArchiveSchema,
  companySchema,
  meetingSchema,
  opportunityChangeSchema,
  opportunityCreateSchema,
  personArchiveSchema,
  personUpdateSchema,
  RecordService,
} from "../../packages/core/records";
import { createLocalDatabase } from "../../packages/database/client";
import { organizations as organizationTable } from "../../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../../packages/database/seed";
import {
  apiOperation,
  type Operation,
} from "../../packages/operations/catalog";
import { RequestError, requestJson } from "../../src/components/client-api";
import { CrmApp } from "../../src/components/crm-app";
import { CompanyRecord } from "../../src/components/records/company-record";
import { PersonRecord } from "../../src/components/records/person-record";
import { type Route, routeFor } from "../../src/components/routes";
import { ActionsView } from "../../src/components/views/actions-view";
import { CompaniesView } from "../../src/components/views/companies-view";
import { MaterialsView } from "../../src/components/views/materials-view";
import { MeetingsView } from "../../src/components/views/meetings-view";
import { OpportunitiesView } from "../../src/components/views/opportunities-view";
import { OutreachView } from "../../src/components/views/outreach-view";
import { OverviewView } from "../../src/components/views/overview-view";
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
  clock: () => number;
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
    overview: OverviewView,
    actions: ActionsView,
    people: PeopleView,
    companies: CompaniesView,
    sequences: SequencesView,
    meetings: MeetingsView,
    opportunities: OpportunitiesView,
    materials: MaterialsView,
    outreach: OutreachView,
    integrations: SettingsView,
    assistants: SettingsView,
    settings: SettingsView,
  };
  const View = views[route.section];
  return <View />;
}

function Routed() {
  return page(routeFor(usePathname()));
}

async function viaCatalog(
  harness: Harness,
  api: Operation["api"],
  method: Operation["method"],
  input: Record<string, unknown>,
) {
  try {
    return serialize(
      await apiOperation(api, method, input.operation).execute(
        { db: harness.local.db, principal },
        input,
      ),
    );
  } catch (error) {
    if (error instanceof DomainError)
      throw new RequestError(error.code, error.details ?? {});
    throw error;
  }
}

async function respondOutreach(
  harness: Harness,
  url: string,
  init?: RequestInit,
) {
  const outreach = new OutreachService(harness.local.db, harness.clock);
  try {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.operation !== "advance") harness.posts.push(body);
      const operations: Record<string, () => Promise<unknown>> = {
        advance: () =>
          outreach.advanceEnrollments(principal, {
            organizationId: body.organizationId,
          }),
        enroll: () => outreach.enroll(principal, enrollSchema.parse(body)),
        draft: () =>
          outreach.editDraft(principal, touchDraftSchema.parse(body)),
        approve: () =>
          outreach.approve(principal, touchApproveSchema.parse(body)),
        sent: () => outreach.markSent(principal, touchSentSchema.parse(body)),
        skip: () => outreach.skip(principal, touchSkipSchema.parse(body)),
        reopen: () => outreach.reopen(principal, touchReopenSchema.parse(body)),
        snooze: () => outreach.snooze(principal, touchSnoozeSchema.parse(body)),
        enrollment: () =>
          outreach.changeEnrollment(
            principal,
            enrollmentChangeSchema.parse(body),
          ),
        relationship: () =>
          outreach.changeRelationship(
            principal,
            relationshipChangeSchema.parse(body),
          ),
        sequence: () =>
          outreach.updateSequence(principal, sequenceUpdateSchema.parse(body)),
        "create-sequence": () =>
          outreach.createSequence(principal, sequenceCreateSchema.parse(body)),
      };
      const run = operations[body.operation];
      if (!run) return viaCatalog(harness, "outreach", "POST", body);
      return serialize(await run());
    }
    const params = Object.fromEntries(
      new URL(url, "http://localhost").searchParams,
    );
    if (
      params.operation &&
      !["touch", "queue", "due"].includes(params.operation)
    )
      return viaCatalog(harness, "outreach", "GET", params);
    const scope = {
      organizationId: params.organizationId || demoId(1),
      ...(params.productId ? { productId: params.productId } : {}),
    };
    if (params.operation === "touch")
      return serialize(
        await outreach.touch(principal, touchQuerySchema.parse(params)),
      );
    if (params.operation === "queue")
      return serialize(await outreach.queue(principal, scope));
    return serialize(await outreach.dueTouches(principal, scope));
  } catch (error) {
    if (error instanceof DomainError)
      throw new RequestError(error.code, error.details ?? {});
    throw error;
  }
}

async function respond(harness: Harness, url: string, init?: RequestInit) {
  if (url.startsWith("/api/outreach"))
    return respondOutreach(harness, url, init);
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
    const records = new RecordService(harness.local.db);
    const operations: Record<string, () => Promise<unknown>> = {
      deal: () =>
        service.saveOpportunity(principal, opportunitySchema.parse(body)),
      "person-update": () =>
        records.updatePerson(principal, personUpdateSchema.parse(body)),
      "person-archive": () =>
        records.archivePerson(principal, personArchiveSchema.parse(body)),
      company: () => records.saveCompany(principal, companySchema.parse(body)),
      "company-archive": () =>
        records.archiveCompany(principal, companyArchiveSchema.parse(body)),
      meeting: () => records.saveMeeting(principal, meetingSchema.parse(body)),
      opportunity: () =>
        records.createOpportunity(
          principal,
          opportunityCreateSchema.parse(body),
        ),
      "opportunity-change": () =>
        records.changeOpportunity(
          principal,
          opportunityChangeSchema.parse(body),
        ),
    };
    const run = operations[body.operation];
    if (run) return serialize(await run());
    return viaCatalog(harness, "crm", "POST", body);
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
  if (params.get("operation") === "person")
    return serialize(
      await service.personContext(
        principal,
        organizationId,
        params.get("personId") || "",
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
    // The UI and service must use the same workspace zone, including at midnight.
    for (const organization of organizations)
      await harness.local.db
        .update(organizationTable)
        .set({ timezone: organization.timezone })
        .where(eq(organizationTable.id, organization.id));
    harness.service = new CrmService(harness.local.db);
    harness.posts = [];
    harness.clock = Date.now;
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

export async function mountCrm(
  harness: Harness,
  path = "/actions",
  { demo = true }: { demo?: boolean } = {},
) {
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
      demo={demo}
    >
      <Routed />
    </CrmApp>,
  );
  await act(async () => {});
}
