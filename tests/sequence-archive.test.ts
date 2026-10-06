import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import { ProductService } from "../packages/core/products";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const owner: Principal = { userId: demoUser, source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
const agent: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: false,
};

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(async () => {
  await local.client.close();
});

function find(name: string) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`MISSING_OPERATION:${name}`);
  return operation;
}
async function run<T = Record<string, unknown>>(
  name: string,
  principal: Principal,
  input: Record<string, unknown>,
) {
  return (await find(name).execute(
    { db: local.db, principal },
    { organizationId: org, ...input },
  )) as T;
}
async function sequence(id: string) {
  const [row] = await local.db
    .select()
    .from(s.sequences)
    .where(eq(s.sequences.id, id));
  if (!row) throw new Error("sequence fixture");
  return row;
}
async function enrollment(id: string) {
  const [row] = await local.db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.id, id));
  if (!row) throw new Error("enrollment fixture");
  return row;
}

describe("archive_sequence", () => {
  test("pauses running enrollments with a manual reason and leaves closed ones alone", async () => {
    const before = await sequence(demoId(400));
    const running = [
      await enrollment(demoId(501)),
      await enrollment(demoId(502)),
    ];
    const result = await run<{ pausedEnrollments: number; archivedAt: Date }>(
      "archive_sequence",
      owner,
      { sequenceId: demoId(400), version: before.version },
    );
    expect(result.pausedEnrollments).toBe(2);
    const after = await sequence(demoId(400));
    expect(after.archivedAt).toBeInstanceOf(Date);
    expect(after.version).toBe(before.version + 1);
    for (const row of running)
      expect(await enrollment(row.id)).toMatchObject({
        status: "paused",
        pauseReason: "manual",
        version: row.version + 1,
      });
    expect(await enrollment(demoId(500))).toMatchObject({
      status: "paused",
      pauseReason: "reply",
    });
    expect(await enrollment(demoId(503))).toMatchObject({ status: "stopped" });
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, demoId(400)));
    expect(events.map((event) => event.type)).toContain("sequence.archived");
  });

  test("refuses a stale version and a sequence that is already archived", async () => {
    const { version } = await sequence(demoId(400));
    await expect(
      run("archive_sequence", owner, {
        sequenceId: demoId(400),
        version: version + 5,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await run("archive_sequence", owner, { sequenceId: demoId(400), version });
    await expect(
      run("archive_sequence", owner, {
        sequenceId: demoId(400),
        version: version + 1,
      }),
    ).rejects.toMatchObject({ code: "SEQUENCE_ARCHIVED", status: 409 });
  });

  test("an archived sequence refuses new enrollments and resuming a paused one", async () => {
    const { version } = await sequence(demoId(401));
    await run("archive_sequence", owner, { sequenceId: demoId(401), version });
    await expect(
      run("enroll_in_sequence", owner, {
        sequenceId: demoId(401),
        relationshipIds: [demoId(306)],
      }),
    ).rejects.toMatchObject({ code: "SEQUENCE_ARCHIVED" });
    const paused = await enrollment(demoId(504));
    expect(paused.status).toBe("paused");
    await expect(
      run("change_enrollment", owner, {
        enrollmentId: paused.id,
        version: paused.version,
        command: "resume",
      }),
    ).rejects.toMatchObject({ code: "SEQUENCE_ARCHIVED" });
    await expect(
      run("change_enrollment", owner, {
        enrollmentId: paused.id,
        version: paused.version,
        command: "stop",
      }),
    ).resolves.toMatchObject({ status: "stopped" });
  });

  test("needs write access to the sequence's product", async () => {
    const { version } = await sequence(demoId(400));
    await expect(
      run("archive_sequence", restricted, {
        sequenceId: demoId(400),
        version,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(
        "archive_sequence",
        { ...agent, readOnly: true },
        { sequenceId: demoId(400), version },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(
        "archive_sequence",
        { ...agent, productIds: [demoId(11)] },
        { sequenceId: demoId(400), version },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(operationRequirements(find("archive_sequence"))).toMatchObject({
      scopes: ["crm:read", "crm:write"],
      administrator: false,
      allProducts: false,
      productAuthorization: true,
    });
  });
});

describe("restore_sequence", () => {
  test("restores an archived sequence, keeps its enrollments paused and allows enrolling again", async () => {
    const { version } = await sequence(demoId(401));
    await run("archive_sequence", owner, { sequenceId: demoId(401), version });
    const restored = await run<{ archivedAt: Date | null; version: number }>(
      "restore_sequence",
      owner,
      { sequenceId: demoId(401), version: version + 1 },
    );
    expect(restored).toMatchObject({ archivedAt: null, version: version + 2 });
    expect(await enrollment(demoId(504))).toMatchObject({
      status: "paused",
      pauseReason: "manual",
    });
    await expect(
      run("enroll_in_sequence", owner, {
        sequenceId: demoId(401),
        relationshipIds: [demoId(306)],
        dryRun: true,
      }),
    ).resolves.toMatchObject({ dryRun: true });
    await expect(
      run("restore_sequence", owner, {
        sequenceId: demoId(401),
        version: version + 2,
      }),
    ).rejects.toMatchObject({ code: "SEQUENCE_ACTIVE", status: 409 });
  });

  test("an archived sequence stays readable in the workspace snapshot", async () => {
    const { version } = await sequence(demoId(400));
    await run("archive_sequence", owner, { sequenceId: demoId(400), version });
    const snapshot = await run<{
      sequences: { id: string; archivedAt: string | Date | null }[];
    }>("get_workspace", owner, {});
    expect(
      snapshot.sequences.find((row) => row.id === demoId(400))?.archivedAt,
    ).toBeTruthy();
  });
});

describe("archived work stays closed", () => {
  const day = 86400000;
  let clock = Date.parse("2026-10-05T06:00:00Z");
  async function completedEnrollment() {
    const crm = new CrmService(local.db);
    const outreach = new OutreachService(local.db, () => clock);
    const product = await crm.createProduct(owner, org, "Closed work");
    const person = await crm.createPerson(owner, {
      organizationId: org,
      productId: product.id,
      name: "Closed work person",
      email: "closed-work@example.test",
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const created = await outreach.createSequence(owner, {
      organizationId: org,
      productId: product.id,
      name: "One step",
      steps: [
        {
          number: 1,
          name: "Intro",
          delayDays: 0,
          channel: "gmail",
          template: "Hello",
          followUp: 0,
        },
      ],
    });
    await outreach.enroll(owner, {
      organizationId: org,
      sequenceId: created.id,
      relationshipIds: [person.relationshipId],
      dryRun: false,
    });
    const [touch] = await local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.relationshipId, person.relationshipId));
    if (!touch) throw new Error("touch fixture");
    const skipped = await outreach.skip(owner, {
      organizationId: org,
      touchId: touch.id,
      version: touch.version,
      reason: "Met in person",
    });
    clock += day;
    await outreach.advanceEnrollments(owner, { organizationId: org });
    const [closed] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.relationshipId, person.relationshipId));
    if (!closed) throw new Error("enrollment fixture");
    expect(closed.status).toBe("completed");
    return {
      outreach,
      product,
      person,
      sequence: await sequence(created.id),
      touch: skipped,
      enrollment: closed,
    };
  }

  test("reopening a touch never revives a completed enrollment in an archived sequence", async () => {
    const f = await completedEnrollment();
    await run("archive_sequence", owner, {
      sequenceId: f.sequence.id,
      version: f.sequence.version,
    });
    await expect(
      f.outreach.reopen(owner, {
        organizationId: org,
        touchId: f.touch.id,
        version: f.touch.version,
      }),
    ).rejects.toMatchObject({ code: "SEQUENCE_ARCHIVED", status: 409 });
    expect(await enrollment(f.enrollment.id)).toMatchObject({
      status: "completed",
    });
  });

  test("reopening a touch never revives a completed enrollment in an archived product", async () => {
    const f = await completedEnrollment();
    await new ProductService(local.db).archive(owner, {
      organizationId: org,
      productId: f.product.id,
    });
    await expect(
      f.outreach.reopen(owner, {
        organizationId: org,
        touchId: f.touch.id,
        version: f.touch.version,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED", status: 409 });
    expect(await enrollment(f.enrollment.id)).toMatchObject({
      status: "completed",
    });
  });

  test("advancing skips running enrollments in an archived sequence or product", async () => {
    const crm = new CrmService(local.db);
    const outreach = new OutreachService(local.db, () => clock);
    const product = await crm.createProduct(owner, org, "Advance guard");
    const person = await crm.createPerson(owner, {
      organizationId: org,
      productId: product.id,
      name: "Advance guard person",
      email: "advance-guard@example.test",
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const created = await outreach.createSequence(owner, {
      organizationId: org,
      productId: product.id,
      name: "Two steps",
      steps: [0, 3].map((delayDays, index) => ({
        number: index + 1,
        name: `Step ${index + 1}`,
        delayDays,
        channel: "gmail" as const,
        template: "Hello",
        followUp: index,
      })),
    });
    await outreach.enroll(owner, {
      organizationId: org,
      sequenceId: created.id,
      relationshipIds: [person.relationshipId],
      dryRun: false,
    });
    const touchesFor = async () =>
      local.db
        .select({ stepNumber: s.touches.stepNumber })
        .from(s.touches)
        .where(eq(s.touches.relationshipId, person.relationshipId));
    const [first] = await local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.relationshipId, person.relationshipId));
    if (!first) throw new Error("touch fixture");
    await outreach.skip(owner, {
      organizationId: org,
      touchId: first.id,
      version: first.version,
      reason: "Not yet",
    });
    expect(await touchesFor()).toHaveLength(1);
    clock += 10 * day;
    await local.db
      .update(s.sequences)
      .set({ archivedAt: new Date(clock) })
      .where(eq(s.sequences.id, created.id));
    await outreach.advanceEnrollments(owner, { organizationId: org });
    expect(await touchesFor()).toHaveLength(1);
    await local.db
      .update(s.sequences)
      .set({ archivedAt: null })
      .where(eq(s.sequences.id, created.id));
    await local.db
      .update(s.products)
      .set({ archivedAt: new Date(clock) })
      .where(eq(s.products.id, product.id));
    await outreach.advanceEnrollments(owner, { organizationId: org });
    expect(await touchesFor()).toHaveLength(1);
    await local.db
      .update(s.products)
      .set({ archivedAt: null })
      .where(eq(s.products.id, product.id));
    await outreach.advanceEnrollments(owner, { organizationId: org });
    expect(await touchesFor()).toHaveLength(2);
  });
});
