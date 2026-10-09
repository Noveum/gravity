import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let crm: CrmService;
let outreach: OutreachService;
let now = Date.parse("2026-10-09T06:00:00Z");
let counter = 0;
const day = 86400000;
const organizationId = demoId(1);
const admin: Principal = { userId: demoUser, source: "demo" };

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  crm = new CrmService(local.db);
  outreach = new OutreachService(local.db, () => now);
});

afterAll(async () => {
  await local.client.close();
});

function assistant(productIds: string[]): Principal {
  return {
    userId: demoUser,
    source: "mcp",
    organizationId,
    productIds,
    readOnly: false,
  };
}

async function delayedEnrollment() {
  counter += 1;
  const product = await crm.createProduct(
    admin,
    organizationId,
    `Scoped outreach fixture ${counter}`,
  );
  const person = await crm.createPerson(admin, {
    organizationId,
    productId: product.id,
    name: `Fictional scoped person ${counter}`,
    email: `outreach-scope-${counter}@example.test`,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel: "gmail",
  });
  const sequence = await outreach.createSequence(admin, {
    organizationId,
    productId: product.id,
    name: "Delayed first touch",
    steps: [
      {
        number: 1,
        name: "Introduction",
        delayDays: 1,
        channel: "gmail",
        template: "A fictional introduction.",
        followUp: 0,
      },
    ],
  });
  const result = await outreach.enroll(admin, {
    organizationId,
    sequenceId: sequence.id,
    relationshipIds: [person.relationshipId],
    dryRun: false,
  });
  const enrollmentId = result.enrolled[0]?.enrollmentId;
  if (!enrollmentId) throw new Error("missing fixture enrollment");
  return {
    productId: product.id,
    personId: person.personId,
    relationshipId: person.relationshipId,
    enrollmentId,
  };
}

async function enrollment(id: string) {
  const [row] = await local.db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.id, id));
  if (!row) throw new Error("missing fixture enrollment");
  return row;
}

async function touches(enrollmentId: string) {
  return local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.enrollmentId, enrollmentId));
}

test("advancing a selected product leaves another authorized product's eligible enrollment unchanged", async () => {
  const selected = await delayedEnrollment();
  const other = await delayedEnrollment();
  const before = await enrollment(other.enrollmentId);
  const actor = assistant([selected.productId, other.productId]);
  now += day;

  const result = await outreach.advanceEnrollments(actor, {
    organizationId,
    productId: selected.productId,
  });

  expect(result).toEqual({ created: 1, completed: 0, paused: 0 });
  expect(await touches(selected.enrollmentId)).toMatchObject([
    { productId: selected.productId, status: "planned", stepNumber: 1 },
  ]);
  expect(await touches(other.enrollmentId)).toEqual([]);
  expect(await enrollment(other.enrollmentId)).toEqual(before);
});

test("advancing an ungranted or foreign product is rejected without changing enrollments", async () => {
  const allowed = await delayedEnrollment();
  const ungranted = await delayedEnrollment();
  const before = await enrollment(ungranted.enrollmentId);
  // The demo fixture's product 13 belongs to another organization.
  const actor = assistant([allowed.productId, demoId(13)]);
  now += day;

  for (const productId of [ungranted.productId, demoId(13)])
    await expect(
      outreach.advanceEnrollments(actor, { organizationId, productId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

  expect(await touches(allowed.enrollmentId)).toEqual([]);
  expect(await touches(ungranted.enrollmentId)).toEqual([]);
  expect(await enrollment(ungranted.enrollmentId)).toEqual(before);
});

test("omitting productId advances every authorized product and leaves ungranted products unchanged", async () => {
  const first = await delayedEnrollment();
  const second = await delayedEnrollment();
  const hidden = await delayedEnrollment();
  const before = await enrollment(hidden.enrollmentId);
  const actor = assistant([first.productId, second.productId]);
  now += day;

  const result = await outreach.advanceEnrollments(actor, { organizationId });

  expect(result).toEqual({ created: 2, completed: 0, paused: 0 });
  expect(await touches(first.enrollmentId)).toHaveLength(1);
  expect(await touches(second.enrollmentId)).toHaveLength(1);
  expect(await touches(hidden.enrollmentId)).toEqual([]);
  expect(await enrollment(hidden.enrollmentId)).toEqual(before);
});

test("selected product scope also confines enrollment completion and do-not-contact pauses", async () => {
  const selectedComplete = await delayedEnrollment();
  const otherComplete = await delayedEnrollment();
  const selectedPause = await delayedEnrollment();
  const otherPause = await delayedEnrollment();
  const actor = assistant([
    selectedComplete.productId,
    otherComplete.productId,
    selectedPause.productId,
    otherPause.productId,
  ]);
  // Persist completed-step fixtures without invoking skip's automatic advancement.
  for (const fixture of [selectedComplete, otherComplete])
    await local.db.insert(s.touches).values({
      organizationId,
      productId: fixture.productId,
      relationshipId: fixture.relationshipId,
      enrollmentId: fixture.enrollmentId,
      stepNumber: 1,
      followUp: 0,
      channel: "gmail",
      senderId: demoUser,
      dueAt: new Date(now),
      status: "skipped",
      closedAt: new Date(now),
    });
  for (const fixture of [selectedPause, otherPause])
    await local.db
      .update(s.people)
      .set({ doNotContact: true })
      .where(eq(s.people.id, fixture.personId));
  const otherCompleteBefore = await enrollment(otherComplete.enrollmentId);
  const otherPauseBefore = await enrollment(otherPause.enrollmentId);
  now += day;

  expect(
    await outreach.advanceEnrollments(actor, {
      organizationId,
      productId: selectedComplete.productId,
    }),
  ).toEqual({ created: 0, completed: 1, paused: 0 });
  expect(await enrollment(selectedComplete.enrollmentId)).toMatchObject({
    status: "completed",
  });
  expect(
    await outreach.advanceEnrollments(actor, {
      organizationId,
      productId: selectedPause.productId,
    }),
  ).toEqual({ created: 0, completed: 0, paused: 1 });
  expect(await enrollment(selectedPause.enrollmentId)).toMatchObject({
    status: "paused",
    pauseReason: "do_not_contact",
  });
  expect(await enrollment(otherComplete.enrollmentId)).toEqual(
    otherCompleteBefore,
  );
  expect(await enrollment(otherPause.enrollmentId)).toEqual(otherPauseBefore);
  expect(await touches(otherPause.enrollmentId)).toEqual([]);
});

test("read-only and empty product grants cannot advance eligible enrollments", async () => {
  const fixture = await delayedEnrollment();
  const before = await enrollment(fixture.enrollmentId);
  const scope = { organizationId, productId: fixture.productId };
  now += day;

  await expect(
    outreach.advanceEnrollments(
      { ...assistant([fixture.productId]), readOnly: true },
      scope,
    ),
  ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED", status: 403 });
  await expect(
    outreach.advanceEnrollments(assistant([]), scope),
  ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  expect(
    await outreach.advanceEnrollments(assistant([]), { organizationId }),
  ).toEqual({ created: 0, completed: 0, paused: 0 });
  expect(await touches(fixture.enrollmentId)).toEqual([]);
  expect(await enrollment(fixture.enrollmentId)).toEqual(before);
});
