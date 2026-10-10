import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { RecordService } from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { apiOperation } from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let crm: CrmService;
let records: RecordService;

const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const org = demoId(1);
const otherOrg = demoId(2);
const productA = demoId(10);
const productB = demoId(11);

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  crm = new CrmService(local.db);
  records = new RecordService(local.db);
});

afterAll(async () => {
  await local.client.close();
});

describe("Merge Duplicate Records", () => {
  test("merging people is atomic and recorded in change_events", async () => {
    // Create Person 1 (target)
    const [target] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Canonical Alice",
        email: "alice.canonical@example.test",
        title: "VP Sales",
      })
      .returning();

    // Create Person 2 (source)
    const [source] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Duplicate Alice",
        email: "alice.dup@example.test",
        title: "VP of Sales",
        phone: "+15551234567",
      })
      .returning();

    // Target has relationship in productA
    const [targetRel] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: org,
        productId: productA,
        personId: target.id,
        ownerId: demoUser,
        purpose: "buyer",
      })
      .returning();

    // Source has relationship in productA
    const [sourceRel] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: org,
        productId: productA,
        personId: source.id,
        ownerId: demoUser,
        purpose: "buyer",
      })
      .returning();

    // Attach action and meeting to sourceRel
    const [action] = await local.db
      .insert(s.actions)
      .values({
        organizationId: org,
        productId: productA,
        relationshipId: sourceRel.id,
        ownerId: demoUser,
        kind: "reply",
        title: "Source reply action",
        reason: "Source reason",
        owedBy: "us",
        channel: "gmail",
        dueAt: new Date(),
      })
      .returning();

    const [meeting] = await local.db
      .insert(s.meetings)
      .values({
        organizationId: org,
        productId: productA,
        relationshipId: sourceRel.id,
        title: "Source meeting",
        startsAt: new Date(),
        status: "scheduled",
      })
      .returning();

    // Perform merge
    const merged = await records.mergeRecords(admin, {
      organizationId: org,
      entity: "person",
      targetId: target.id,
      targetVersion: target.version,
      sourceId: source.id,
      sourceVersion: source.version,
      phone: "+15551234567", // picked from source
    });

    expect(merged.id).toBe(target.id);
    expect(merged.name).toBe("Canonical Alice");
    expect("phone" in merged ? merged.phone : undefined).toBe("+15551234567");
    expect(merged.version).toBe(target.version + 1);

    // Source is deleted
    const [sourceFound] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, source.id));
    expect(sourceFound).toBeUndefined();

    // Source relationship was deleted and children moved to target relationship
    const [movedAction] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, action.id));
    expect(movedAction?.relationshipId).toBe(targetRel.id);

    const [movedMeeting] = await local.db
      .select()
      .from(s.meetings)
      .where(eq(s.meetings.id, meeting.id));
    expect(movedMeeting?.relationshipId).toBe(targetRel.id);

    // change_events contains person.merged
    const [changeEvent] = await local.db
      .select()
      .from(s.changeEvents)
      .where(
        and(
          eq(s.changeEvents.entityId, target.id),
          eq(s.changeEvents.type, "person.merged"),
        ),
      );
    expect(changeEvent).toBeDefined();
    expect(changeEvent.actorId).toBe(admin.userId);
  });

  test("covers cross-product relationships", async () => {
    // Person A in productA
    const [personA] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Cross Product Target",
        email: "target.cross@example.test",
      })
      .returning();

    const [_relA] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: org,
        productId: productA,
        personId: personA.id,
        ownerId: demoUser,
        purpose: "buyer",
      })
      .returning();

    // Person B in productB
    const [personB] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Cross Product Source",
        email: "source.cross@example.test",
      })
      .returning();

    const [relB] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: org,
        productId: productB,
        personId: personB.id,
        ownerId: demoUser,
        purpose: "buyer",
      })
      .returning();

    // Stage for opportunity in productB
    const [stageB] = await local.db
      .select()
      .from(s.stages)
      .where(
        and(
          eq(s.stages.organizationId, org),
          eq(s.stages.productId, productB),
          eq(s.stages.pipeline, "deal"),
        ),
      )
      .limit(1);

    const [deal] = await local.db
      .insert(s.opportunities)
      .values({
        organizationId: org,
        productId: productB,
        relationshipId: relB.id,
        stageId: stageB.id,
        name: "Cross Product Deal",
      })
      .returning();

    // Merge personB into personA
    await records.mergeRecords(admin, {
      organizationId: org,
      entity: "person",
      targetId: personA.id,
      targetVersion: personA.version,
      sourceId: personB.id,
      sourceVersion: personB.version,
    });

    // Person A now has both relationships!
    const targetRelationships = await local.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.personId, personA.id));

    expect(targetRelationships).toHaveLength(2);
    expect(targetRelationships.map((r) => r.productId).sort()).toEqual(
      [productA, productB].sort(),
    );

    // relB now belongs to personA
    const [updatedRelB] = await local.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.id, relB.id));
    expect(updatedRelB?.personId).toBe(personA.id);

    // Deal is intact and still points to relB
    const [foundDeal] = await local.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, deal.id));
    expect(foundDeal?.relationshipId).toBe(relB.id);
  });

  test("private conversation ownership stays private after merge", async () => {
    const [target] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Private Convo Target",
        email: "target.private@example.test",
      })
      .returning();

    const [targetRel] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: org,
        productId: productA,
        personId: target.id,
        ownerId: demoUser,
        purpose: "buyer",
      })
      .returning();

    const [source] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Private Convo Source",
        email: "source.private@example.test",
      })
      .returning();

    const [sourceRel] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: org,
        productId: productA,
        personId: source.id,
        ownerId: demoUser,
        purpose: "buyer",
      })
      .returning();

    // Private conversation owned by teammate
    const [privateConvo] = await local.db
      .insert(s.conversations)
      .values({
        organizationId: org,
        productId: productA,
        relationshipId: sourceRel.id,
        ownerId: teammate.userId,
        visibility: "private",
        provenance: "native",
        channel: "gmail",
        externalThreadId: randomUUID(),
      })
      .returning();

    // Merge source into target
    await records.mergeRecords(admin, {
      organizationId: org,
      entity: "person",
      targetId: target.id,
      targetVersion: target.version,
      sourceId: source.id,
      sourceVersion: source.version,
    });

    // Check conversation row in database: ownership and visibility are intact
    const [updatedConvo] = await local.db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, privateConvo.id));

    expect(updatedConvo?.relationshipId).toBe(targetRel.id);
    expect(updatedConvo?.ownerId).toBe(teammate.userId);
    expect(updatedConvo?.visibility).toBe("private");

    // teammate can view the conversation in context
    const teammateContext = await crm.context(teammate, org, targetRel.id);
    expect(
      teammateContext.conversations.some((c) => c.id === privateConvo.id),
    ).toBe(true);

    // admin (who is not the owner) cannot view this private conversation in context
    const adminContext = await crm.context(admin, org, targetRel.id);
    expect(
      adminContext.conversations.some((c) => c.id === privateConvo.id),
    ).toBe(false);
  });

  test("refuses merge across organizations", async () => {
    const [target] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Org1 Person",
        email: "org1@example.test",
      })
      .returning();

    const [sourceForeign] = await local.db
      .insert(s.people)
      .values({
        organizationId: otherOrg,
        name: "Org2 Person",
        email: "org2@example.test",
      })
      .returning();

    // Attempting to merge across organizations
    await expect(
      records.mergeRecords(admin, {
        organizationId: org,
        entity: "person",
        targetId: target.id,
        targetVersion: target.version,
        sourceId: sourceForeign.id,
        sourceVersion: sourceForeign.version,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    // Neither record was deleted or modified
    const [stillTarget] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, target.id));
    expect(stillTarget?.version).toBe(target.version);

    const [stillSource] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, sourceForeign.id));
    expect(stillSource?.version).toBe(sourceForeign.version);
  });

  test("merges duplicate companies and repoints employees", async () => {
    const [companyA] = await local.db
      .insert(s.companies)
      .values({
        organizationId: org,
        name: "Acme Corp Canonical",
        domain: "acme.com",
        description: "Canonical description",
      })
      .returning();

    const [companyB] = await local.db
      .insert(s.companies)
      .values({
        organizationId: org,
        name: "Acme Corp Duplicate",
        domain: "acme-corp.com",
        description: "Secondary description",
      })
      .returning();

    // Person linked to companyB
    const [employee] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Acme Employee",
        email: "emp@acme-corp.com",
        companyId: companyB.id,
      })
      .returning();

    await local.db.insert(s.relationships).values({
      organizationId: org,
      productId: productA,
      personId: employee.id,
      ownerId: demoUser,
      purpose: "buyer",
    });

    // Merge companyB into companyA
    const merged = await records.mergeRecords(admin, {
      organizationId: org,
      entity: "company",
      targetId: companyA.id,
      targetVersion: companyA.version,
      sourceId: companyB.id,
      sourceVersion: companyB.version,
      description: "Merged description",
    });

    expect(merged.id).toBe(companyA.id);
    expect(merged.name).toBe("Acme Corp Canonical");
    expect("description" in merged ? merged.description : undefined).toBe(
      "Merged description",
    );
    expect(merged.version).toBe(companyA.version + 1);

    // companyB was deleted
    const [bFound] = await local.db
      .select()
      .from(s.companies)
      .where(eq(s.companies.id, companyB.id));
    expect(bFound).toBeUndefined();

    // Employee was repointed to companyA
    const [updatedEmp] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, employee.id));
    expect(updatedEmp?.companyId).toBe(companyA.id);

    // change_events contains company.merged
    const [changeEvent] = await local.db
      .select()
      .from(s.changeEvents)
      .where(
        and(
          eq(s.changeEvents.entityId, companyA.id),
          eq(s.changeEvents.type, "company.merged"),
        ),
      );
    expect(changeEvent).toBeDefined();
  });

  test("rejects self-merge and version conflicts", async () => {
    const [person] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Self Merge Person",
        email: "self.merge@example.test",
      })
      .returning();

    // Self merge
    await expect(
      records.mergeRecords(admin, {
        organizationId: org,
        entity: "person",
        targetId: person.id,
        targetVersion: person.version,
        sourceId: person.id,
        sourceVersion: person.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const [second] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Second Person",
        email: "second@example.test",
      })
      .returning();

    // Stale version
    await expect(
      records.mergeRecords(admin, {
        organizationId: org,
        entity: "person",
        targetId: person.id,
        targetVersion: person.version + 99,
        sourceId: second.id,
        sourceVersion: second.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  test("merge operation is executable via catalog operation", async () => {
    const [p1] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Op Target",
        email: "op.target@example.test",
      })
      .returning();

    const [p2] = await local.db
      .insert(s.people)
      .values({
        organizationId: org,
        name: "Op Source",
        email: "op.source@example.test",
      })
      .returning();

    await local.db.insert(s.relationships).values([
      {
        organizationId: org,
        productId: productA,
        personId: p1.id,
        ownerId: demoUser,
        purpose: "buyer",
      },
      {
        organizationId: org,
        productId: productA,
        personId: p2.id,
        ownerId: demoUser,
        purpose: "buyer",
      },
    ]);

    const op = apiOperation("crm", "POST", "merge-records");
    expect(op.name).toBe("merge_records");

    const result = (await op.execute(
      { db: local.db, principal: admin },
      {
        operation: "merge-records",
        organizationId: org,
        entity: "person",
        targetId: p1.id,
        targetVersion: p1.version,
        sourceId: p2.id,
        sourceVersion: p2.version,
        name: "Op Combined",
      },
    )) as typeof s.people.$inferSelect;

    expect(result.id).toBe(p1.id);
    expect(result.name).toBe("Op Combined");
  });
});
