import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  contactHistoryChecks,
  contactIdentityIds,
} from "../packages/core/contact-history";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { optedOutIdentity } from "../packages/core/visibility";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const owner: Principal = { userId: demoUser, source: "session" };
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());

async function fixture() {
  const crm = new CrmService(local.db);
  const id = randomUUID();
  const firstProduct = await crm.createProduct(
    owner,
    org,
    `Fictional history ${id}`,
  );
  const secondProduct = await crm.createProduct(
    owner,
    org,
    `Fictional other history ${id}`,
  );
  const first = await crm.createPerson(owner, {
    organizationId: org,
    productId: firstProduct.id,
    name: "Fictional history recipient",
    email: `${id}@example.test`,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel: "gmail",
  });
  const [person] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, first.personId));
  const [bridge] = await local.db
    .insert(s.people)
    .values({
      organizationId: org,
      name: "Fictional legacy bridge",
      email: `${id}-alias@example.test`,
      otherEmails: [`  ${person.email?.toUpperCase()}  `],
    })
    .returning();
  const [last] = await local.db
    .insert(s.people)
    .values({
      organizationId: org,
      name: "Fictional legacy duplicate",
      email: `${id}-last@example.test`,
      otherEmails: [bridge.email?.toUpperCase() ?? ""],
      doNotContact: true,
    })
    .returning();
  const [relationship] = await local.db
    .insert(s.relationships)
    .values({
      organizationId: org,
      productId: secondProduct.id,
      personId: last.id,
      ownerId: owner.userId,
      purpose: "buyer",
    })
    .returning();
  const [conversation] = await local.db
    .insert(s.conversations)
    .values({
      organizationId: org,
      productId: secondProduct.id,
      relationshipId: relationship.id,
      ownerId: "demo-teammate",
      connectionId: null,
      provenance: "native",
      externalThreadId: id,
      channel: "linkedin",
      visibility: "private",
    })
    .returning();
  await local.db.insert(s.messages).values({
    organizationId: org,
    productId: secondProduct.id,
    conversationId: conversation.id,
    connectionId: null,
    providerMessageId: id,
    direction: "outbound",
    body: "Private fictional contents must stay hidden",
    occurredAt: new Date("2026-10-01T00:00:00Z"),
  });
  return { person, bridge, last, conversation, firstProduct, secondProduct };
}

test("identity checks follow normalized alternate addresses through legacy duplicate chains", async () => {
  const f = await fixture();
  const expected = [f.person.id, f.bridge.id, f.last.id].sort();
  for (const person of [f.person, f.bridge, f.last]) {
    expect(await contactIdentityIds(local.db, org, person)).toEqual(expected);
    expect(await optedOutIdentity(local.db, org, person)).toBe(true);
  }
  expect(await contactIdentityIds(local.db, demoId(2), f.person)).toEqual([]);
});

test("private or ungranted identity history blocks dispatch without exposing another owner's contents", async () => {
  const f = await fixture();
  const granted = await contactHistoryChecks(local.db, owner, org, f.person, [
    f.firstProduct.id,
    f.secondProduct.id,
  ]);
  expect(granted).toMatchObject({
    blockedBy: "PRIVATE_HISTORY_REVIEW_REQUIRED",
    messages: [],
  });
  await local.db
    .update(s.conversations)
    .set({ visibility: "product" })
    .where(eq(s.conversations.id, f.conversation.id));
  const ungranted = await contactHistoryChecks(local.db, owner, org, f.person, [
    f.firstProduct.id,
  ]);
  expect(ungranted).toMatchObject({
    blockedBy: "PRIVATE_HISTORY_REVIEW_REQUIRED",
    messages: [],
  });
  const visible = await contactHistoryChecks(local.db, owner, org, f.person, [
    f.firstProduct.id,
    f.secondProduct.id,
  ]);
  expect(visible.blockedBy).toBeNull();
  expect(visible.messages[0]).toMatchObject({
    channel: "linkedin",
    body: "Private fictional contents must stay hidden",
  });
});

test("pending history matches aliases on the complete identity and preserves owner/product access", async () => {
  const f = await fixture();
  await local.db
    .delete(s.messages)
    .where(eq(s.messages.conversationId, f.conversation.id));
  const [connection] = await local.db
    .insert(s.connections)
    .values({
      organizationId: org,
      productId: f.secondProduct.id,
      ownerId: owner.userId,
      provider: "gmail",
      externalAccountId: randomUUID(),
      status: "connected",
    })
    .returning();
  await local.db.insert(s.integrationItems).values({
    organizationId: org,
    productId: f.secondProduct.id,
    connectionId: connection.id,
    externalId: randomUUID(),
    record: {
      kind: "message",
      externalId: "fictional-pending",
      title: "Fictional pending",
      body: "Pending contents must not leak",
      occurredAt: "2026-10-01T00:00:00Z",
      participants: [f.last.email?.toUpperCase() ?? ""],
    },
  });
  expect(
    await contactHistoryChecks(local.db, owner, org, f.person, [
      f.firstProduct.id,
    ]),
  ).toMatchObject({
    blockedBy: "PRIVATE_HISTORY_REVIEW_REQUIRED",
    messages: [],
  });
  expect(
    await contactHistoryChecks(local.db, owner, org, f.person, [
      f.firstProduct.id,
      f.secondProduct.id,
    ]),
  ).toMatchObject({
    blockedBy: "PENDING_HISTORY_REVIEW_REQUIRED",
    messages: [],
  });
});

test("participant-free pending messages use the linked thread's product rather than the account default", async () => {
  const f = await fixture();
  await local.db
    .delete(s.messages)
    .where(eq(s.messages.conversationId, f.conversation.id));
  const [connection] = await local.db
    .insert(s.connections)
    .values({
      organizationId: org,
      productId: f.firstProduct.id,
      ownerId: owner.userId,
      provider: "unipile",
      externalAccountId: randomUUID(),
      status: "connected",
    })
    .returning();
  await local.db
    .update(s.conversations)
    .set({
      connectionId: connection.id,
      provenance: "provider",
      ownerId: owner.userId,
    })
    .where(eq(s.conversations.id, f.conversation.id));
  await local.db.insert(s.integrationItems).values({
    organizationId: org,
    productId: f.firstProduct.id,
    connectionId: connection.id,
    externalId: randomUUID(),
    record: {
      externalId: "fictional-pending-linked-message",
      threadId: f.conversation.externalThreadId,
      kind: "message",
      title: "Fictional pending poll",
      body: "Pending private contents must not leak",
      occurredAt: "2026-10-01T00:00:00Z",
      direction: "inbound",
      participants: [],
    },
  });
  expect(
    await contactHistoryChecks(local.db, owner, org, f.person, [
      f.firstProduct.id,
    ]),
  ).toMatchObject({
    blockedBy: "PRIVATE_HISTORY_REVIEW_REQUIRED",
    messages: [],
  });
  expect(
    await contactHistoryChecks(local.db, owner, org, f.person, [
      f.firstProduct.id,
      f.secondProduct.id,
    ]),
  ).toMatchObject({
    blockedBy: "PENDING_HISTORY_REVIEW_REQUIRED",
    messages: [],
  });
});
