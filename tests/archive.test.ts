import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import { errorResponse } from "../packages/core/http";
import type { Principal } from "../packages/core/policy";
import { DomainError } from "../packages/core/policy";
import {
  companySchema,
  meetingSchema,
  opportunityChangeSchema,
  opportunityCreateSchema,
  personUpdateSchema,
  RecordService,
} from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { mcpHandler } from "../packages/mcp/server";
import { errorText, RequestError } from "../src/components/client-api";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let crm: CrmService;
let records: RecordService;
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
const org = demoId(1);

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  crm = new CrmService(local.db);
  records = new RecordService(local.db);
});
afterAll(async () => {
  await local.client.close();
});

async function person(id: number) {
  const [row] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, demoId(id)));
  if (!row) throw new Error("missing person");
  return row;
}
async function action(id: string) {
  const [row] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, id));
  if (!row) throw new Error("missing action");
  return row;
}
async function events(entityId: string) {
  return (
    await local.db
      .select({ type: s.changeEvents.type })
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, entityId))
  ).map((row) => row.type);
}
async function archive(id: number, archived: boolean, by = admin) {
  const current = await person(id);
  return records.archivePerson(by, {
    organizationId: org,
    personId: current.id,
    version: current.version,
    archived,
  });
}
async function approve(actionId: string) {
  const current = await action(actionId);
  const saved = await crm.changeAction(admin, {
    organizationId: org,
    actionId,
    version: current.version,
    command: "save",
    draft: "A fictional reviewed note.",
  });
  return crm.changeAction(admin, {
    organizationId: org,
    actionId,
    version: saved.version,
    command: "approve",
  });
}
async function mcpCall(name: string, args: object) {
  const response = await mcpHandler(
    local.db,
    { ...admin, source: "mcp", readOnly: true, organizationId: org },
    org,
  ).fetch(
    new Request("http://127.0.0.1:3014/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  return response.text();
}

describe("archiving a person stops their work", () => {
  test("archive clears approvals and pauses running sequences; restore resumes neither", async () => {
    const approved = await approve(demoId(604));
    expect(approved.approvedHash).toBeTruthy();
    await archive(204, true);
    expect(await action(demoId(604))).toMatchObject({
      approvedHash: null,
      approvedBy: null,
      version: approved.version + 1,
    });
    expect(await events(demoId(604))).toContain("action.approval_invalidated");
    const [paused] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(501)));
    expect(paused).toMatchObject({ status: "paused_archived", version: 2 });
    expect(await events(demoId(501))).toContain("enrollment.paused");
    await archive(204, false);
    const [still] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(501)));
    expect(still?.status).toBe("paused_archived");
    expect((await action(demoId(604))).approvedHash).toBeNull();
  });

  test("every write service refuses an archived person's relationships until restore", async () => {
    const meeting = await records.saveMeeting(
      admin,
      meetingSchema.parse({
        organizationId: org,
        relationshipId: demoId(304),
        title: "Fictional review",
        startsAt: "2030-01-01T09:00:00.000Z",
        status: "scheduled",
      }),
    );
    const deal = await records.createOpportunity(
      admin,
      opportunityCreateSchema.parse({
        organizationId: org,
        relationshipId: demoId(304),
        stageId: demoId(800),
        name: "Fictional model testing",
      }),
    );
    await archive(204, true);
    await archive(202, true);
    const current = await action(demoId(604));
    const refusals: [string, () => Promise<unknown>][] = [
      [
        "scheduleAction",
        () =>
          crm.scheduleAction(admin, {
            organizationId: org,
            relationshipId: demoId(304),
            ownerId: demoUser,
            kind: "research",
            channel: "research",
            owedBy: "us",
            title: "Blocked",
            reason: "",
            dueAt: new Date().toISOString(),
          }),
      ],
      [
        "changeAction",
        () =>
          crm.changeAction(admin, {
            organizationId: org,
            actionId: current.id,
            version: current.version,
            command: "save",
            draft: "Blocked",
          }),
      ],
      [
        "planActions",
        () =>
          crm.planActions(admin, {
            organizationId: org,
            items: [
              {
                actionId: current.id,
                version: current.version,
                status: "completed",
              },
            ],
          }),
      ],
      [
        "acceptCommitment",
        () =>
          crm.acceptCommitment(admin, {
            organizationId: org,
            meetingId: demoId(1000),
            version: 1,
            dueAt: new Date().toISOString(),
            ownerId: demoUser,
          }),
      ],
      [
        "saveMeeting",
        () =>
          records.saveMeeting(
            admin,
            meetingSchema.parse({
              organizationId: org,
              meetingId: meeting.id,
              version: meeting.version,
              title: "Blocked",
              startsAt: "2030-01-01T09:00:00.000Z",
              status: "held",
            }),
          ),
      ],
      [
        "changeOpportunity",
        () =>
          records.changeOpportunity(
            admin,
            opportunityChangeSchema.parse({
              organizationId: org,
              opportunityId: deal.id,
              version: deal.version,
              stageId: demoId(801),
            }),
          ),
      ],
    ];
    for (const [name, run] of refusals)
      await expect(run(), name).rejects.toMatchObject({
        code: "RECORD_ARCHIVED",
      });
    await archive(204, false);
    await archive(202, false);
    const moved = await records.changeOpportunity(
      admin,
      opportunityChangeSchema.parse({
        organizationId: org,
        opportunityId: deal.id,
        version: deal.version,
        stageId: demoId(801),
      }),
    );
    expect(moved.stageId).toBe(demoId(801));
  });

  test("a plan from someone without the product is refused as forbidden, not as archived", async () => {
    await archive(204, true);
    const current = await action(demoId(604));
    await expect(
      crm.planActions(restricted, {
        organizationId: org,
        items: [
          {
            actionId: current.id,
            version: current.version,
            status: "completed",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await archive(204, false);
  });

  test("archiving needs write access to every brand the person belongs to", async () => {
    await expect(archive(200, true, restricted)).rejects.toMatchObject({
      code: "ARCHIVE_NEEDS_EVERY_BRAND",
      details: { count: 1 },
    });
    expect((await person(200)).archivedAt).toBeNull();
    await archive(200, true, teammate);
    await expect(archive(200, false, restricted)).rejects.toMatchObject({
      code: "ARCHIVE_NEEDS_EVERY_BRAND",
    });
    await archive(200, false, teammate);
    await archive(201, true, restricted);
    await archive(201, false, restricted);
  });

  test("a company whose people are all archived keeps those people's brands", async () => {
    await archive(204, true);
    const hidden = await crm.snapshot(restricted, { organizationId: org });
    expect(
      [...hidden.companies, ...hidden.archived.companies].some(
        (company) => company.id === demoId(104),
      ),
    ).toBe(false);
    await expect(
      records.saveCompany(
        restricted,
        companySchema.parse({
          organizationId: org,
          companyId: demoId(104),
          version: 1,
          name: "Not theirs",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const shown = await crm.snapshot(admin, { organizationId: org });
    expect(shown.companies.some((company) => company.id === demoId(104))).toBe(
      true,
    );
    expect(
      shown.archived.people.find((row) => row.id === demoId(204))?.productIds,
    ).toEqual([demoId(10)]);
    await archive(204, false);
  });

  test("assistants cannot read an archived person or company", async () => {
    await archive(203, true);
    const [harbor] = await local.db
      .select()
      .from(s.companies)
      .where(eq(s.companies.id, demoId(105)));
    if (!harbor) throw new Error("missing company");
    await records.archiveCompany(admin, {
      organizationId: org,
      companyId: harbor.id,
      version: harbor.version,
      archived: true,
    });
    const personBody = await mcpCall("get_person_context", {
      relationshipId: demoId(303),
    });
    expect(personBody).not.toContain("Theo Grant");
    expect(personBody).toContain("NOT_FOUND");
    const companyBody = await mcpCall("get_company_context", {
      companyId: demoId(105),
    });
    expect(companyBody).not.toContain("Vale Software");
    expect(companyBody).toContain("NOT_FOUND");
    expect(
      await mcpCall("get_person_context", { relationshipId: demoId(302) }),
    ).toContain("Leena Rao");
    await archive(203, false);
  });
});

describe("refusal messages", () => {
  test("the shared-person refusal carries its count to the message", async () => {
    const response = errorResponse(
      new DomainError("ARCHIVE_NEEDS_EVERY_BRAND", 403, { count: 2 }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "ARCHIVE_NEEDS_EVERY_BRAND",
      details: { count: 2 },
    });
    const message = errorText(
      new RequestError("ARCHIVE_NEEDS_EVERY_BRAND", { count: 2 }),
    );
    expect(message).toBe(
      t.errors.ARCHIVE_NEEDS_EVERY_BRAND.replace("{count}", "2"),
    );
    expect(message).toContain("2");
  });
});

describe("editing details", () => {
  test("other emails cannot collide with anyone's primary or other emails", async () => {
    const jonah = await person(201);
    await records.updatePerson(
      admin,
      personUpdateSchema.parse({
        organizationId: org,
        personId: jonah.id,
        version: jonah.version,
        name: jonah.name,
        email: jonah.email,
        otherEmails: ["shared@example.test"],
      }),
    );
    const ellis = await person(205);
    for (const changes of [
      { email: "SHARED@example.test" },
      { otherEmails: ["person1@example.test"] },
      { otherEmails: ["shared@example.test"] },
    ])
      await expect(
        records.updatePerson(
          admin,
          personUpdateSchema.parse({
            organizationId: org,
            personId: ellis.id,
            version: ellis.version,
            name: ellis.name,
            email: ellis.email,
            ...changes,
          }),
        ),
      ).rejects.toMatchObject({ code: "PERSON_EXISTS" });
    await expect(
      crm.createPerson(admin, {
        organizationId: org,
        productId: demoId(10),
        name: "Fictional Duplicate",
        email: "shared@example.test",
        title: "",
        purpose: "buyer",
        context: "",
        review: false,
        channel: "gmail",
      }),
    ).rejects.toMatchObject({ code: "PERSON_EXISTS" });
  });

  test("an edit without a company keeps the current one, even when it is archived", async () => {
    const ellis = await person(205);
    expect(ellis.companyId).toBe(demoId(105));
    const updated = await records.updatePerson(
      admin,
      personUpdateSchema.parse({
        organizationId: org,
        personId: ellis.id,
        version: ellis.version,
        name: "Ellis Park",
        title: "Director",
        email: ellis.email,
      }),
    );
    expect(updated).toMatchObject({
      title: "Director",
      companyId: demoId(105),
    });
  });

  test("a change that changes nothing keeps the version and writes no event", async () => {
    const [deal] = await local.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, demoId(1100)));
    if (!deal) throw new Error("missing deal");
    const same = await records.changeOpportunity(
      admin,
      opportunityChangeSchema.parse({
        organizationId: org,
        opportunityId: deal.id,
        version: deal.version,
        stageId: deal.stageId,
        name: deal.name,
      }),
    );
    expect(same.version).toBe(deal.version);
    expect(await events(deal.id)).toEqual([]);
  });
});
