import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ContactAttributionService,
  recordProviderContribution,
} from "../packages/core/contact-attribution";
import { CrmService, personSchema } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import {
  RecordListService,
  recordListSchema,
} from "../packages/core/record-list";
import { personUpdateSchema, RecordService } from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: ContactAttributionService;
let crm: CrmService;
const org = demoId(1),
  product = demoId(10),
  otherProduct = demoId(12);
const alex: Principal = { userId: demoUser, source: "session" };
const sam: Principal = {
  userId: "demo-teammate",
  source: "mcp",
  organizationId: org,
  readOnly: false,
  clientId: "verified-agent-client",
  grantId: demoId(809),
};
const restricted: Principal = { userId: "demo-restricted", source: "session" };
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new ContactAttributionService(local.db);
  crm = new CrmService(local.db);
});
afterAll(async () => {
  await local.client.close();
});
const batch = (actor: Principal, key: string, extra: object = {}) =>
  service.createBatch(actor, {
    organizationId: org,
    productId: product,
    label: "Fictional contacts.csv",
    sourceKind: "file",
    submissionKey: key,
    ...extra,
  });
const create = (actor: Principal, name: string, extra: object = {}) =>
  crm.createPerson(
    actor,
    personSchema.parse({
      organizationId: org,
      productId: product,
      name,
      review: false,
      ...extra,
    }),
  );
const history = (actor: Principal, personId: string, extra: object = {}) =>
  service.list(actor, { organizationId: org, personId, ...extra });

describe("trusted contact attribution", () => {
  test("transport parity assigns the real submitter and declared source separately; retries retain one immutable batch", async () => {
    const operation = apiOperation("crm", "POST", "import-batch");
    const input = {
      productId: product,
      label: "Reviewed fixture",
      sourceKind: "file",
      sourceMemberId: "demo-teammate",
      submissionKey: "declared-source",
      submittedBy: "demo-teammate",
      clientId: "forged",
    };
    const first = (await operation.execute(
      { db: local.db, principal: alex },
      { ...input, organizationId: org, operation: "import-batch" },
    )) as typeof s.contactImportBatches.$inferSelect;
    expect(first).toMatchObject({
      submittedBy: demoUser,
      sourceMemberId: "demo-teammate",
      transport: "session",
      clientId: null,
      grantId: null,
    });
    const second = await operation.execute(
      { db: local.db, principal: alex },
      { ...input, organizationId: org },
    );
    expect(second).toEqual(first);
    await expect(
      operation.execute(
        { db: local.db, principal: alex },
        { ...input, organizationId: org, label: "Changed" },
      ),
    ).rejects.toMatchObject({ code: "IMPORT_SOURCE_CONFLICT" });
    const assistantBatch = (await executeMcpOperation(
      operation,
      { db: local.db, principal: sam },
      org,
      { ...input, sourceMemberId: demoUser },
    )) as typeof s.contactImportBatches.$inferSelect;
    expect(assistantBatch).toMatchObject({
      submittedBy: sam.userId,
      sourceMemberId: demoUser,
      clientId: sam.clientId,
      grantId: sam.grantId,
      transport: "mcp",
    });
    expect(assistantBatch.id).not.toBe(first.id);
  });
  test("new imports retry atomically and do not create another person or replace creator", async () => {
    const source = await batch(sam, "new-import");
    const input = {
      importSource: { batchId: source.id, sourceRecordId: "row-1" },
    };
    const [first, retry] = await Promise.all([
      create(sam, "Fictional imported person", input),
      create(sam, "Fictional imported person", input),
    ]);
    expect(first).toEqual(retry);
    const result = await history(alex, first.personId);
    expect(result.creator).toMatchObject({
      actorId: sam.userId,
      clientId: sam.clientId,
      sourceRecordId: "row-1",
      batchId: source.id,
    });
    expect(result.items).toHaveLength(1);
    await expect(
      create(sam, "Different identity", input),
    ).rejects.toMatchObject({ code: "IMPORT_SOURCE_CONFLICT" });
    await expect(create(alex, "Borrowed batch", input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  test("both contributors share a confirmed identity without changing owner or creator; stale versions and row reuse cannot forge it", async () => {
    const contact = await create(alex, "Joint fixture contact");
    const source = await batch(sam, "shared-import", {
      sourceMemberId: sam.userId,
    });
    const record = {
      organizationId: org,
      productId: product,
      personId: contact.personId,
      version: 1,
      batchId: source.id,
      sourceRecordId: "row-2",
    };
    await service.recordImport(sam, record);
    await service.recordImport(sam, { ...record, version: 999 });
    const result = await history(alex, contact.personId);
    expect(result.creator?.actorId).toBe(demoUser);
    expect(result.items).toHaveLength(2);
    const [relationship] = await local.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.id, contact.relationshipId));
    expect(relationship.ownerId).toBe(demoUser);
    const other = await create(alex, "Separate fixture contact");
    await expect(
      service.recordImport(sam, { ...record, personId: other.personId }),
    ).rejects.toMatchObject({ code: "IMPORT_SOURCE_CONFLICT" });
    await expect(
      service.recordImport(sam, {
        ...record,
        sourceRecordId: "row-3",
        version: 999,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const lists = new RecordListService(local.db);
    const shared = await lists.page(
      alex,
      recordListSchema.parse({
        organizationId: org,
        entity: "people",
        attribution: "shared",
        sourceMemberId: sam.userId,
      }),
    );
    expect(shared.items.map((row) => row.id)).toContain(contact.personId);
    const combined = await lists.page(
      alex,
      recordListSchema.parse({
        organizationId: org,
        entity: "people",
        submittedBy: demoUser,
        sourceMemberId: sam.userId,
      }),
    );
    expect(combined.items.map((row) => row.id)).toContain(contact.personId);
    const impossible = await lists.page(
      alex,
      recordListSchema.parse({
        organizationId: org,
        entity: "people",
        submittedBy: demoUser,
        attribution: "unknown",
      }),
    );
    expect(impossible.items).toHaveLength(0);

    const submitted = await lists.page(
      alex,
      recordListSchema.parse({
        organizationId: org,
        entity: "people",
        submittedBy: sam.userId,
      }),
    );
    expect(submitted.items.map((row) => row.id)).toContain(contact.personId);
  });
  test("history and contributor filters respect organization, product and private provider account access", async () => {
    const contact = await create(alex, "Private source fixture");
    const [connection] = await local.db
      .insert(s.connections)
      .values({
        organizationId: org,
        productId: product,
        ownerId: sam.userId,
        provider: "gmail",
        externalAccountId: "fictional-private-account",
      })
      .returning();
    await recordProviderContribution(local.db, connection, {
      personId: contact.personId,
      productId: product,
      sourceRecordId: "private-provider-row",
    });
    await recordProviderContribution(local.db, connection, {
      personId: contact.personId,
      productId: product,
      sourceRecordId: "private-provider-row",
    });
    expect(
      (await history(sam, contact.personId)).items.find((row) => row.provider),
    ).toMatchObject({
      actorId: null,
      sourceMemberId: sam.userId,
      transport: "system",
    });
    const visible = await history(alex, contact.personId);
    expect(JSON.stringify(visible)).not.toContain("private-provider-row");
    expect(visible.items).toHaveLength(1);
    const filtered = await new RecordListService(local.db).page(
      alex,
      recordListSchema.parse({
        organizationId: org,
        entity: "people",
        sourceMemberId: sam.userId,
      }),
    );
    expect(filtered.items.map((row) => row.id)).not.toContain(contact.personId);
    await expect(history(restricted, contact.personId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      service.list(
        { ...sam, productIds: [otherProduct] },
        { organizationId: org, personId: contact.personId },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.list(sam, {
        organizationId: demoId(2),
        personId: contact.personId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const hiddenSnapshot = await crm.snapshot(
      { ...sam, productIds: [otherProduct] },
      { organizationId: org },
    );
    expect(
      hiddenSnapshot.contactAttribution.map((row) => row.personId),
    ).not.toContain(contact.personId);
  });
  test("edits retain creator, do not become submission contributions, and names survive membership deactivation", async () => {
    const contact = await create(alex, "Edited fixture contact");
    const records = new RecordService(local.db);
    await records.updatePerson(
      sam,
      personUpdateSchema.parse({
        organizationId: org,
        personId: contact.personId,
        version: 1,
        name: "Updated fixture",
      }),
    );
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, sam.userId),
        ),
      );
    const result = await history(alex, contact.personId);
    expect(result.creator?.actorName).toBe("Alex Morgan");
    expect(result.lastEditor).toMatchObject({
      actorId: sam.userId,
      actorName: "Sam Rivera",
    });
    const snapshot = await crm.snapshot(alex, { organizationId: org });
    expect(
      snapshot.contactAttribution.filter(
        (row) => row.personId === contact.personId,
      ),
    ).toEqual([
      {
        personId: contact.personId,
        productId: product,
        actorId: demoUser,
        sourceMemberId: null,
      },
    ]);
    await expect(batch(sam, "revoked")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await local.db
      .update(s.memberships)
      .set({ active: true })
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, sam.userId),
        ),
      );
  });
  test("archived contact attribution stays out of compact snapshots and read-only assistants", async () => {
    const contact = await create(alex, "Archived provenance fixture");
    await local.db
      .update(s.people)
      .set({ archivedAt: new Date() })
      .where(eq(s.people.id, contact.personId));
    const reader = { ...sam, readOnly: true };
    expect(
      (
        await crm.snapshot(reader, { organizationId: org })
      ).contactAttribution.map((row) => row.personId),
    ).not.toContain(contact.personId);
    await expect(history(reader, contact.personId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await history(alex, contact.personId)).creator?.actorId).toBe(
      demoUser,
    );
  });
  test("unknown historical creator is not inferred from ownership and invalid source members cannot be declared", async () => {
    expect((await history(alex, demoId(200))).creator).toBeNull();
    await expect(
      batch(alex, "invalid-member", { sourceMemberId: "missing-member" }),
    ).rejects.toMatchObject({ code: "SOURCE_MEMBER_NOT_ALLOWED" });
    await expect(
      batch(alex, "wrong-product-member", {
        sourceMemberId: restricted.userId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_MEMBER_NOT_ALLOWED" });
    await expect(
      batch({ ...sam, readOnly: true }, "readonly"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      batch(alex, "cross-tenant", {
        organizationId: demoId(2),
        productId: product,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const unknown = await new RecordListService(local.db).page(
      alex,
      recordListSchema.parse({
        organizationId: org,
        entity: "people",
        attribution: "unknown",
      }),
    );
    expect(unknown.items.map((row) => row.id)).toContain(demoId(200));
  });
});
