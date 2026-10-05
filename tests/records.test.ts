import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
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

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let crm: CrmService;
let records: RecordService;
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
const assistant: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: demoId(1),
};
const org = demoId(1);
const mira = demoId(200);

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  crm = new CrmService(local.db);
  records = new RecordService(local.db);
});
afterAll(async () => {
  await local.client.close();
});

async function person(id: string) {
  const [row] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, id));
  if (!row) throw new Error("missing person");
  return row;
}
async function events(entityId: string) {
  const rows = await local.db
    .select({ type: s.changeEvents.type, productId: s.changeEvents.productId })
    .from(s.changeEvents)
    .where(eq(s.changeEvents.entityId, entityId));
  return rows.map((row) => row.type);
}
function edit(id: string, version: number, changes: object = {}) {
  return personUpdateSchema.parse({
    organizationId: org,
    personId: id,
    version,
    name: "Mira Chen",
    title: "Engineering lead",
    email: "person0@example.test",
    ...changes,
  });
}

describe("editing people", () => {
  test("a visible person is edited with every field, a version bump and a change event", async () => {
    const before = await person(mira);
    const revision = await crm.revision(restricted, org);
    const updated = await records.updatePerson(
      restricted,
      edit(mira, before.version, {
        name: "Mira Chen-Park",
        title: "VP Engineering",
        otherEmails: ["Mira@Personal.example.test", "person0@example.test"],
        phone: "+1 (555) 010-2000",
        linkedinUrl: "https://www.linkedin.com/in/fictional-mira",
        companyId: demoId(101),
        summary: "Leads the evaluation.",
      }),
    );
    expect(updated).toMatchObject({
      name: "Mira Chen-Park",
      title: "VP Engineering",
      otherEmails: ["mira@personal.example.test"],
      phone: "+1 (555) 010-2000",
      linkedinUrl: "https://www.linkedin.com/in/fictional-mira",
      companyId: demoId(101),
      summary: "Leads the evaluation.",
      version: before.version + 1,
    });
    expect(await events(mira)).toContain("person.updated");
    expect(await crm.revision(restricted, org)).not.toBe(revision);
    await expect(
      records.updatePerson(restricted, edit(mira, before.version)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("people outside the editor's products, organization or role cannot be edited", async () => {
    const leena = await person(demoId(202));
    await expect(
      records.updatePerson(restricted, edit(leena.id, leena.version)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      records.updatePerson(teammate, {
        ...edit(demoId(206), 1),
        organizationId: demoId(2),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.updatePerson(assistant, edit(leena.id, leena.version)),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      records.updatePerson(
        { ...teammate, readOnly: true },
        edit(leena.id, leena.version),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await person(leena.id)).version).toBe(leena.version);
  });

  test("an edit cannot take another person's email or a company from another workspace", async () => {
    const current = await person(mira);
    await expect(
      records.updatePerson(
        admin,
        edit(mira, current.version, {
          name: current.name,
          email: "PERSON1@example.test",
        }),
      ),
    ).rejects.toMatchObject({ code: "PERSON_EXISTS" });
    await expect(
      records.updatePerson(
        admin,
        edit(mira, current.version, { companyId: demoId(106) }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() =>
      edit(mira, 1, { linkedinUrl: "https://evil.example/in/mira" }),
    ).toThrow();
    expect(() =>
      edit(mira, 1, { linkedinUrl: "javascript:alert(1)//linkedin.com" }),
    ).toThrow();
    expect(() => edit(mira, 1, { phone: "call me" })).toThrow();
  });

  test("changing an email clears every approved draft for the person, in every product", async () => {
    const scheduled = await crm.scheduleAction(admin, {
      organizationId: org,
      relationshipId: demoId(300),
      ownerId: demoUser,
      kind: "reply",
      channel: "gmail",
      owedBy: "us",
      title: "Answer the shortlist question",
      reason: "",
      dueAt: new Date().toISOString(),
    });
    const approve = async (actionId: string, principal: Principal) => {
      const [action] = await local.db
        .select()
        .from(s.actions)
        .where(eq(s.actions.id, actionId));
      if (!action) throw new Error("missing action");
      const saved = await crm.changeAction(principal, {
        organizationId: org,
        actionId,
        version: action.version,
        command: "save",
        draft: "A fictional reviewed reply.",
      });
      return crm.changeAction(principal, {
        organizationId: org,
        actionId,
        version: saved.version,
        command: "approve",
      });
    };
    const hidden = await approve(scheduled.actionId, admin);
    const visible = await approve(demoId(606), teammate);
    expect(hidden.approvedHash).toBeTruthy();
    expect(visible.approvedHash).toBeTruthy();
    const current = await person(mira);
    await records.updatePerson(
      restricted,
      edit(mira, current.version, {
        name: current.name,
        companyId: current.companyId,
      }),
    );
    const untouched = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(606)));
    expect(untouched[0]?.approvedHash).toBe(visible.approvedHash);
    const renamed = await person(mira);
    await records.updatePerson(
      restricted,
      edit(mira, renamed.version, {
        name: renamed.name,
        companyId: renamed.companyId,
        email: "mira.new@example.test",
      }),
    );
    const after = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.relationshipId, demoId(300)));
    const reply = after.find((action) => action.id === scheduled.actionId);
    expect(reply).toMatchObject({
      approvedHash: null,
      approvedBy: null,
      version: hidden.version + 1,
    });
    const [coordination] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(606)));
    expect(coordination).toMatchObject({
      approvedHash: null,
      version: visible.version + 1,
    });
    expect(await events(scheduled.actionId)).toContain(
      "action.approval_invalidated",
    );
  });
});

describe("archiving people", () => {
  test("an archived person leaves every list with their work, stays readable and comes back on restore", async () => {
    const jonah = await person(demoId(201));
    const archived = await records.archivePerson(teammate, {
      organizationId: org,
      personId: jonah.id,
      version: jonah.version,
      archived: true,
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const hidden = await crm.snapshot(teammate, { organizationId: org });
    expect(hidden.people.some((row) => row.id === jonah.id)).toBe(false);
    expect(hidden.relationships.some((row) => row.id === demoId(301))).toBe(
      false,
    );
    expect(
      hidden.actions.some((row) => row.relationshipId === demoId(301)),
    ).toBe(false);
    expect(hidden.archived.people.map((row) => row.id)).toContain(jonah.id);
    const context = await crm.personContext(teammate, org, jonah.id);
    expect(context.person?.archivedAt).toBeTruthy();
    await expect(
      records.updatePerson(teammate, edit(jonah.id, archived.version)),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await expect(
      records.saveMeeting(
        teammate,
        meetingSchema.parse({
          organizationId: org,
          relationshipId: demoId(301),
          title: "Call",
          startsAt: new Date().toISOString(),
          status: "scheduled",
        }),
      ),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await expect(
      crm.createPerson(teammate, {
        organizationId: org,
        productId: demoId(10),
        personId: jonah.id,
        title: "",
        purpose: "buyer",
        context: "",
        review: false,
        channel: "gmail",
      }),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await expect(
      records.archivePerson(teammate, {
        organizationId: org,
        personId: jonah.id,
        version: jonah.version,
        archived: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await records.archivePerson(teammate, {
      organizationId: org,
      personId: jonah.id,
      version: archived.version,
      archived: false,
    });
    const restored = await crm.snapshot(teammate, { organizationId: org });
    expect(restored.people.some((row) => row.id === jonah.id)).toBe(true);
    expect(
      restored.actions.some((row) => row.relationshipId === demoId(301)),
    ).toBe(true);
    expect(await events(jonah.id)).toEqual(
      expect.arrayContaining(["person.archived", "person.restored"]),
    );
  });

  test("only people the member can see may be archived", async () => {
    const leena = await person(demoId(202));
    await expect(
      records.archivePerson(restricted, {
        organizationId: org,
        personId: leena.id,
        version: leena.version,
        archived: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await person(leena.id)).archivedAt).toBeNull();
  });
});

describe("companies", () => {
  test("a new company is visible to every member until someone joins it, and people can join it", async () => {
    const created = await records.saveCompany(
      restricted,
      companySchema.parse({
        organizationId: org,
        name: "Fictional Orbit Works",
        domain: "https://WWW.orbit-works.example.test/about",
        description: "Created in a test.",
      }),
    );
    expect(created.domain).toBe("orbit-works.example.test");
    expect(await events(created.id)).toContain("company.created");
    for (const principal of [admin, teammate, restricted]) {
      const data = await crm.snapshot(principal, { organizationId: org });
      expect(data.companies.some((row) => row.id === created.id)).toBe(true);
    }
    await expect(
      records.saveCompany(
        teammate,
        companySchema.parse({
          organizationId: org,
          name: "Duplicate",
          domain: "orbit-works.example.test",
        }),
      ),
    ).rejects.toMatchObject({ code: "COMPANY_EXISTS" });
    const joined = await crm.createPerson(admin, {
      organizationId: org,
      productId: demoId(10),
      name: "Fictional Joiner",
      email: "joiner@example.test",
      title: "",
      companyId: created.id,
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    expect(joined.personId).toBeTruthy();
    const hidden = await crm.snapshot(restricted, { organizationId: org });
    expect(hidden.companies.some((row) => row.id === created.id)).toBe(false);
    await expect(
      records.saveCompany(
        restricted,
        companySchema.parse({
          organizationId: org,
          companyId: created.id,
          version: created.version,
          name: "Renamed by someone who cannot see it",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("companies are edited with a version check and archived out of lists", async () => {
    const [harbor] = await local.db
      .select()
      .from(s.companies)
      .where(eq(s.companies.id, demoId(103)));
    if (!harbor) throw new Error("missing company");
    const renamed = await records.saveCompany(
      admin,
      companySchema.parse({
        organizationId: org,
        companyId: harbor.id,
        version: harbor.version,
        name: "Harbor Analytics Group",
        domain: harbor.domain,
        description: "Renamed.",
      }),
    );
    expect(renamed).toMatchObject({
      name: "Harbor Analytics Group",
      version: harbor.version + 1,
    });
    await expect(
      records.saveCompany(
        admin,
        companySchema.parse({
          organizationId: org,
          companyId: harbor.id,
          version: harbor.version,
          name: "Stale",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const archived = await records.archiveCompany(admin, {
      organizationId: org,
      companyId: harbor.id,
      version: renamed.version,
      archived: true,
    });
    const data = await crm.snapshot(admin, { organizationId: org });
    expect(data.companies.some((row) => row.id === harbor.id)).toBe(false);
    expect(data.archived.companies.map((row) => row.id)).toContain(harbor.id);
    const context = await crm.companyContext(
      admin,
      { organizationId: org },
      harbor.id,
    );
    expect(context.company.archivedAt).toBeTruthy();
    await expect(
      crm.createPerson(admin, {
        organizationId: org,
        productId: demoId(10),
        name: "Fictional Late Joiner",
        title: "",
        companyId: harbor.id,
        purpose: "buyer",
        context: "",
        review: false,
        channel: "gmail",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await records.archiveCompany(admin, {
      organizationId: org,
      companyId: harbor.id,
      version: archived.version,
      archived: false,
    });
    expect(await events(harbor.id)).toEqual(
      expect.arrayContaining([
        "company.updated",
        "company.archived",
        "company.restored",
      ]),
    );
  });

  test("assistants cannot create companies and domains must be hostnames", async () => {
    await expect(
      records.saveCompany(
        assistant,
        companySchema.parse({ organizationId: org, name: "Agent Co" }),
      ),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    expect(() =>
      companySchema.parse({
        organizationId: org,
        name: "Bad",
        domain: "not a domain",
      }),
    ).toThrow();
    expect(() =>
      companySchema.parse({
        organizationId: org,
        companyId: demoId(100),
        name: "Missing version",
      }),
    ).toThrow();
  });
});

describe("meetings", () => {
  test("meetings are created in the relationship's product and edited with a version check", async () => {
    const created = await records.saveMeeting(
      restricted,
      meetingSchema.parse({
        organizationId: org,
        relationshipId: demoId(301),
        title: "Fictional API walkthrough",
        startsAt: "2026-11-02T10:00:00.000Z",
        status: "scheduled",
      }),
    );
    expect(created).toMatchObject({
      productId: demoId(11),
      relationshipId: demoId(301),
      version: 1,
    });
    const held = await records.saveMeeting(
      restricted,
      meetingSchema.parse({
        organizationId: org,
        meetingId: created.id,
        version: created.version,
        title: "Fictional API walkthrough",
        startsAt: "2026-11-02T10:30:00.000Z",
        status: "held",
        summary: "Covered the rate limits.",
      }),
    );
    expect(held).toMatchObject({ status: "held", version: 2 });
    expect(await events(created.id)).toEqual([
      "meeting.created",
      "meeting.updated",
    ]);
    await expect(
      records.saveMeeting(
        restricted,
        meetingSchema.parse({
          organizationId: org,
          meetingId: created.id,
          version: 1,
          title: "Stale",
          startsAt: "2026-11-02T10:00:00.000Z",
          status: "scheduled",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      records.saveMeeting(
        restricted,
        meetingSchema.parse({
          organizationId: org,
          relationshipId: demoId(300),
          title: "Another product",
          startsAt: "2026-11-02T10:00:00.000Z",
          status: "scheduled",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.saveMeeting(
        restricted,
        meetingSchema.parse({
          organizationId: org,
          meetingId: demoId(1001),
          version: 1,
          title: "Edit another product",
          startsAt: "2026-11-02T10:00:00.000Z",
          status: "held",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() =>
      meetingSchema.parse({
        organizationId: org,
        meetingId: created.id,
        version: 2,
        relationshipId: demoId(300),
        title: "Move it",
        startsAt: "2026-11-02T10:00:00.000Z",
        status: "held",
      }),
    ).toThrow();
  });
});

describe("opportunities", () => {
  const stage = (product: number, position: number) =>
    demoId(800 + product * 10 + position);
  test("opportunities are created in the relationship's pipeline and moved into won and lost", async () => {
    const created = await records.createOpportunity(
      restricted,
      opportunityCreateSchema.parse({
        organizationId: org,
        relationshipId: demoId(301),
        stageId: stage(1, 0),
        name: "Fictional API plan",
        amountMinor: 120000,
        currency: "eur",
      }),
    );
    expect(created).toMatchObject({ productId: demoId(11), currency: "EUR" });
    const won = await records.changeOpportunity(
      restricted,
      opportunityChangeSchema.parse({
        organizationId: org,
        opportunityId: created.id,
        version: created.version,
        stageId: stage(1, 3),
      }),
    );
    const lost = await records.changeOpportunity(
      restricted,
      opportunityChangeSchema.parse({
        organizationId: org,
        opportunityId: created.id,
        version: won.version,
        stageId: stage(1, 4),
        amountMinor: null,
      }),
    );
    expect(lost).toMatchObject({ stageId: stage(1, 4), amountMinor: null });
    expect(await events(created.id)).toEqual([
      "opportunity.created",
      "opportunity.won",
      "opportunity.updated",
      "opportunity.lost",
    ]);
    const [category] = await local.db
      .select({ category: s.stages.category })
      .from(s.stages)
      .where(eq(s.stages.id, stage(1, 4)));
    expect(category?.category).toBe("lost");
  });

  test("a stage from another product, a stale version or a foreign opportunity is refused", async () => {
    await expect(
      records.createOpportunity(
        restricted,
        opportunityCreateSchema.parse({
          organizationId: org,
          relationshipId: demoId(301),
          stageId: stage(0, 0),
          name: "Wrong pipeline",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [northstar] = await local.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, demoId(1101)));
    if (!northstar) throw new Error("missing opportunity");
    await expect(
      records.changeOpportunity(
        restricted,
        opportunityChangeSchema.parse({
          organizationId: org,
          opportunityId: northstar.id,
          version: northstar.version,
          stageId: stage(0, 3),
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.changeOpportunity(
        admin,
        opportunityChangeSchema.parse({
          organizationId: org,
          opportunityId: northstar.id,
          version: northstar.version,
          stageId: stage(1, 3),
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await records.changeOpportunity(
      admin,
      opportunityChangeSchema.parse({
        organizationId: org,
        opportunityId: northstar.id,
        version: northstar.version,
        name: "Northstar evaluation",
      }),
    );
    await expect(
      records.changeOpportunity(
        admin,
        opportunityChangeSchema.parse({
          organizationId: org,
          opportunityId: northstar.id,
          version: northstar.version,
          stageId: stage(0, 2),
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(() =>
      opportunityCreateSchema.parse({
        organizationId: org,
        relationshipId: demoId(301),
        stageId: stage(1, 0),
        name: "Negative",
        amountMinor: -1,
      }),
    ).toThrow();
    expect(() =>
      opportunityChangeSchema.parse({
        organizationId: org,
        opportunityId: northstar.id,
        version: 2,
      }),
    ).toThrow();
  });

  test("a new product gets open, won and lost stages", async () => {
    const product = await crm.createProduct(admin, org, "Fictional Pipeline");
    const stages = await local.db
      .select()
      .from(s.stages)
      .where(
        and(
          eq(s.stages.organizationId, org),
          eq(s.stages.productId, product.id),
        ),
      );
    expect(
      stages
        .sort((a, b) => a.position - b.position)
        .map((row) => [row.name, row.category]),
    ).toEqual([
      ["Discovery", "open"],
      ["Evaluation", "open"],
      ["Proposal", "open"],
      ["Won", "won"],
      ["Lost", "lost"],
    ]);
  });
});

describe("the record editing migration", () => {
  test("existing pipelines gain a won category and a lost stage", async () => {
    const folder = await mkdtemp(join(tmpdir(), "gravity-migration-"));
    const client = new PGlite();
    try {
      await cp(join(process.cwd(), "drizzle"), folder, { recursive: true });
      const journalPath = join(folder, "meta", "_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        entries: { tag: string }[];
      };
      const before = {
        ...journal,
        entries: journal.entries.filter(
          (entry) => entry.tag !== "0009_record_editing",
        ),
      };
      await writeFile(journalPath, JSON.stringify(before));
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: folder });
      await client.exec(`
        INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Fixture', 'fixture');
        INSERT INTO products (id, organization_id, name) VALUES ('${demoId(10)}', '${org}', 'Fixture product');
        INSERT INTO stages (organization_id, product_id, name, position) VALUES
          ('${org}', '${demoId(10)}', 'Discovery', 0),
          ('${org}', '${demoId(10)}', 'Won', 1);
        INSERT INTO companies (organization_id, name) VALUES ('${org}', 'Fixture company');
      `);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(db, { migrationsFolder: folder });
      const stages = await client.query<{
        name: string;
        position: number;
        category: string;
      }>("SELECT name, position, category FROM stages ORDER BY position");
      expect(stages.rows).toEqual([
        { name: "Discovery", position: 0, category: "open" },
        { name: "Won", position: 1, category: "won" },
        { name: "Lost", position: 2, category: "lost" },
      ]);
      const companies = await client.query<{
        version: number;
        archived_at: string | null;
      }>("SELECT version, archived_at FROM companies");
      expect(companies.rows).toEqual([{ version: 1, archived_at: null }]);
    } finally {
      await client.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
