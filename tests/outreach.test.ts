import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ingestReply } from "../packages/connectors/replies";
import { CrmService } from "../packages/core/crm";
import {
  externalMessageConflict,
  OutreachService,
  sendGate,
} from "../packages/core/outreach";
import type { ContactRules } from "../packages/core/outreach-rules";
import type { Principal } from "../packages/core/policy";
import {
  companySchema,
  personUpdateSchema,
  RecordService,
} from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let crm: CrmService;
let records: RecordService;
let outreach: OutreachService;
let now = Date.parse("2026-10-05T06:00:00Z");
const day = 86400000;
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
const agent: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: demoId(1),
  readOnly: false,
};
const org = demoId(1);
const steps = [0, 3, 5, 5].map((delayDays, index) => ({
  number: index + 1,
  name: index ? `Follow-up ${index}` : "Introduction",
  delayDays,
  channel: "gmail" as const,
  template: `Fictional template ${index + 1}`,
  followUp: index,
}));

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  crm = new CrmService(local.db);
  records = new RecordService(local.db);
  outreach = new OutreachService(local.db, () => now);
});
afterAll(async () => {
  await local.client.close();
});

let counter = 0;
async function product() {
  counter += 1;
  return crm.createProduct(admin, org, `Outreach fixture ${counter}`);
}
async function fixture(productId?: string) {
  const brand = productId ?? (await product()).id;
  counter += 1;
  const person = await crm.createPerson(admin, {
    organizationId: org,
    productId: brand,
    name: `Fixture person ${counter}`,
    email: `outreach-${counter}@example.test`,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel: "gmail",
  });
  const sequence = await addSequence(brand);
  return {
    productId: brand,
    personId: person.personId,
    relationshipId: person.relationshipId,
    sequenceId: sequence.id,
  };
}
async function addSequence(productId: string) {
  const [sequence] = await local.db
    .insert(s.sequences)
    .values({
      organizationId: org,
      productId,
      name: "Fixture sequence",
      steps,
    })
    .returning();
  if (!sequence) throw new Error("missing sequence");
  return sequence;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function enroll(f: Fixture) {
  return outreach.enroll(admin, {
    organizationId: org,
    sequenceId: f.sequenceId,
    relationshipIds: [f.relationshipId],
    dryRun: false,
  });
}
async function touchesOf(relationshipId: string) {
  return local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.relationshipId, relationshipId))
    .orderBy(asc(s.touches.stepNumber));
}
async function firstTouch(f: Fixture) {
  const [touch] = await touchesOf(f.relationshipId);
  if (!touch) throw new Error("missing touch");
  return touch;
}
async function touchRow(id: string) {
  const [row] = await local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.id, id));
  if (!row) throw new Error("missing touch");
  return row;
}
async function enrollmentOf(relationshipId: string) {
  const [row] = await local.db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.relationshipId, relationshipId));
  if (!row) throw new Error("missing enrollment");
  return row;
}
async function relationshipRow(id: string) {
  const [row] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, id));
  if (!row) throw new Error("missing relationship");
  return row;
}
async function personRow(id: string) {
  const [row] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, id));
  if (!row) throw new Error("missing person");
  return row;
}
async function draftAndApprove(touchId: string, draft = "A fictional note.") {
  const current = await touchRow(touchId);
  const drafted = await outreach.editDraft(admin, {
    organizationId: org,
    touchId,
    version: current.version,
    draft,
  });
  return outreach.approve(admin, {
    organizationId: org,
    touchId,
    version: drafted.version,
  });
}
async function send(touchId: string, by: Principal = admin, extra = {}) {
  return outreach.markSent(by, { organizationId: org, touchId, ...extra });
}
async function setRules(values: Partial<ContactRules>) {
  const current = await outreach.contactRules(admin, org);
  return outreach.updateContactRules(admin, {
    organizationId: org,
    version: current.version,
    cooldownDays: current.cooldownDays,
    dailyCapPerSender: current.dailyCapPerSender,
    quietHoursStart: current.quietHoursStart,
    quietHoursEnd: current.quietHoursEnd,
    ...values,
  });
}

describe("enrollment", () => {
  test("a dry run explains who is skipped and writes nothing", async () => {
    now = Date.parse("2026-10-05T06:00:00Z");
    const f = await fixture();
    const other = await fixture();
    const archivedPerson = await fixture(f.productId);
    const blocked = await fixture(f.productId);
    const current = await personRow(archivedPerson.personId);
    await records.archivePerson(admin, {
      organizationId: org,
      personId: current.id,
      version: current.version,
      archived: true,
    });
    const blockedPerson = await personRow(blocked.personId);
    await outreach.setContactPreferences(admin, {
      organizationId: org,
      personId: blockedPerson.id,
      version: blockedPerson.version,
      doNotContact: true,
      timeZone: null,
    });
    const result = await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: f.sequenceId,
      relationshipIds: [
        f.relationshipId,
        other.relationshipId,
        archivedPerson.relationshipId,
        blocked.relationshipId,
        demoId(399),
      ],
      dryRun: true,
    });
    expect(result.enrolled).toEqual([
      { relationshipId: f.relationshipId, enrollmentId: null },
    ]);
    expect(result.skipped).toEqual([
      { relationshipId: other.relationshipId, reason: "other_brand" },
      { relationshipId: archivedPerson.relationshipId, reason: "archived" },
      { relationshipId: blocked.relationshipId, reason: "do_not_contact" },
      { relationshipId: demoId(399), reason: "not_found" },
    ]);
    for (const { reason } of result.skipped)
      expect(t.outreachCopy.skipReasons).toHaveProperty(reason);
    expect(await touchesOf(f.relationshipId)).toEqual([]);
    expect(
      await local.db
        .select()
        .from(s.enrollments)
        .where(eq(s.enrollments.relationshipId, f.relationshipId)),
    ).toEqual([]);
  });

  test("a dry run reports a relationship in a brand the caller cannot read as not found", async () => {
    now = Date.parse("2026-10-05T06:00:00Z");
    const target = await fixture(demoId(10));
    const readable = await fixture(demoId(11));
    const hidden = await fixture();
    const result = await outreach.enroll(teammate, {
      organizationId: org,
      sequenceId: target.sequenceId,
      relationshipIds: [readable.relationshipId, hidden.relationshipId],
      dryRun: true,
    });
    expect(result.skipped).toEqual([
      { relationshipId: readable.relationshipId, reason: "other_brand" },
      { relationshipId: hidden.relationshipId, reason: "not_found" },
    ]);
  });

  test("enrolling plans the first touch at enrollment time with the step template", async () => {
    now = Date.parse("2026-10-05T06:00:00Z");
    const f = await fixture();
    const result = await enroll(f);
    expect(result.enrolled).toHaveLength(1);
    const enrollment = await enrollmentOf(f.relationshipId);
    expect(enrollment).toMatchObject({ status: "running", pauseReason: null });
    expect(await touchesOf(f.relationshipId)).toMatchObject([
      {
        stepNumber: 1,
        followUp: 0,
        status: "planned",
        senderId: demoUser,
        channel: "gmail",
        draft: "Fictional template 1",
        dueAt: new Date(now),
      },
    ]);
    const again = await enroll(f);
    expect(again.enrolled).toEqual([]);
    expect(again.skipped).toEqual([
      { relationshipId: f.relationshipId, reason: "already_enrolled" },
    ]);
    const second = await addSequence(f.productId);
    const elsewhere = await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: second.id,
      relationshipIds: [f.relationshipId],
      dryRun: false,
    });
    expect(elsewhere.skipped).toEqual([
      { relationshipId: f.relationshipId, reason: "in_another_sequence" },
    ]);
  });

  test("a new person starts at the first outreach stage", async () => {
    const f = await fixture();
    const relationship = await relationshipRow(f.relationshipId);
    const [stage] = await local.db
      .select()
      .from(s.stages)
      .where(eq(s.stages.id, relationship.stageId ?? ""));
    expect(stage).toMatchObject({
      pipeline: "outreach",
      position: 0,
      name: t.outreachStages.new,
    });
  });
});

describe("touch lifecycle", () => {
  test("planned, drafted, approved and sent, with every refused move", async () => {
    now = Date.parse("2026-10-06T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const planned = await firstTouch(f);
    const emptied = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: planned.id,
      version: planned.version,
      draft: "  ",
    });
    expect(emptied.status).toBe("planned");
    await expect(
      outreach.approve(admin, {
        organizationId: org,
        touchId: planned.id,
        version: emptied.version,
      }),
    ).rejects.toMatchObject({ code: "DRAFT_REQUIRED" });
    const drafted = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: planned.id,
      version: emptied.version,
      draft: "Hello, a fictional note.",
    });
    expect(drafted.status).toBe("drafted");
    await expect(
      outreach.approve(
        { ...agent, readOnly: true },
        {
          organizationId: org,
          touchId: planned.id,
          version: drafted.version,
        },
      ),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      outreach.approve(admin, {
        organizationId: org,
        touchId: planned.id,
        version: drafted.version - 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const approved = await outreach.approve(admin, {
      organizationId: org,
      touchId: planned.id,
      version: drafted.version,
    });
    expect(approved).toMatchObject({
      status: "approved",
      approvedBy: demoUser,
      approvedHash: drafted.draftHash,
    });
    const same = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: planned.id,
      version: approved.version,
      draft: "Hello, a fictional note.",
    });
    expect(same).toMatchObject({ status: "approved", approvedBy: demoUser });
    const edited = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: planned.id,
      version: same.version,
      draft: "Hello, an edited fictional note.",
    });
    expect(edited).toMatchObject({
      status: "drafted",
      approvedHash: null,
      approvedBy: null,
    });
    const reapproved = await outreach.approve(admin, {
      organizationId: org,
      touchId: planned.id,
      version: edited.version,
    });
    const snoozed = await outreach.snooze(admin, {
      organizationId: org,
      touchId: planned.id,
      version: reapproved.version,
      dueAt: new Date(now + day).toISOString(),
    });
    expect(snoozed).toMatchObject({
      status: "approved",
      dueAt: new Date(now + day),
    });
    const sent = await send(planned.id, agent, {
      externalMessageId: "fixture-message-1",
    });
    expect(sent.warnings).toEqual([]);
    expect(sent.touch).toMatchObject({
      status: "sent",
      sentBy: demoUser,
      sentAt: new Date(now),
      externalMessageId: "fixture-message-1",
    });
    const relationship = await relationshipRow(f.relationshipId);
    expect(relationship).toMatchObject({
      touchCount: 1,
      lastOutboundAt: new Date(now),
    });
    const before = await relationshipRow(f.relationshipId);
    expect(before.stageId).toBe(relationship.stageId);
    for (const attempt of [
      () =>
        outreach.editDraft(admin, {
          organizationId: org,
          touchId: planned.id,
          version: sent.touch.version,
          draft: "Too late",
        }),
      () =>
        outreach.approve(admin, {
          organizationId: org,
          touchId: planned.id,
          version: sent.touch.version,
        }),
      () =>
        outreach.skip(admin, {
          organizationId: org,
          touchId: planned.id,
          version: sent.touch.version,
          reason: "Not needed",
        }),
      () =>
        outreach.snooze(admin, {
          organizationId: org,
          touchId: planned.id,
          version: sent.touch.version,
          dueAt: new Date(now + day).toISOString(),
        }),
    ])
      await expect(attempt()).rejects.toMatchObject({
        code: "TOUCH_ALREADY_SENT",
      });
  });

  test("a skipped touch is closed and the next step follows from the skip", async () => {
    now = Date.parse("2026-10-07T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const skipped = await outreach.skip(admin, {
      organizationId: org,
      touchId: touch.id,
      version: touch.version,
      reason: "Introduced in person",
    });
    expect(skipped).toMatchObject({
      status: "skipped",
      skipReason: "Introduced in person",
      closedAt: new Date(now),
    });
    for (const attempt of [
      () =>
        outreach.approve(admin, {
          organizationId: org,
          touchId: touch.id,
          version: skipped.version,
        }),
      () => send(touch.id),
      () =>
        outreach.editDraft(admin, {
          organizationId: org,
          touchId: touch.id,
          version: skipped.version,
          draft: "Late",
        }),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: "TOUCH_CLOSED" });
    now += 3 * day;
    await outreach.advanceEnrollments(admin, { organizationId: org });
    expect(await touchesOf(f.relationshipId)).toMatchObject([
      { stepNumber: 1, status: "skipped" },
      { stepNumber: 2, status: "planned", dueAt: new Date(now), followUp: 1 },
    ]);
  });

  test("stopping an enrollment expires its unsent touches", async () => {
    now = Date.parse("2026-10-08T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const enrollment = await enrollmentOf(f.relationshipId);
    await outreach.changeEnrollment(admin, {
      organizationId: org,
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command: "stop",
    });
    expect(await touchesOf(f.relationshipId)).toMatchObject([
      { status: "expired", closedAt: new Date(now) },
    ]);
    const stopped = await enrollmentOf(f.relationshipId);
    await expect(
      outreach.changeEnrollment(admin, {
        organizationId: org,
        enrollmentId: stopped.id,
        version: stopped.version,
        command: "resume",
      }),
    ).rejects.toMatchObject({ code: "ENROLLMENT_CLOSED" });
  });

  test("a paused enrollment keeps its touches, leaves the due list, refuses approval and comes back on resume", async () => {
    now = Date.parse("2026-10-09T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const due = async () =>
      (
        await outreach.dueTouches(admin, {
          organizationId: org,
          productId: f.productId,
        })
      ).groups.flatMap((group) => group.touches.map((row) => row.id));
    expect(await due()).toEqual([touch.id]);
    const enrollment = await enrollmentOf(f.relationshipId);
    const paused = await outreach.changeEnrollment(admin, {
      organizationId: org,
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command: "pause",
    });
    expect(paused).toMatchObject({ status: "paused", pauseReason: "manual" });
    expect(await due()).toEqual([]);
    expect(await touchesOf(f.relationshipId)).toHaveLength(1);
    const drafted = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: touch.id,
      version: touch.version,
      draft: "Prepared while paused",
    });
    await expect(
      outreach.approve(admin, {
        organizationId: org,
        touchId: touch.id,
        version: drafted.version,
      }),
    ).rejects.toMatchObject({ code: "ENROLLMENT_PAUSED" });
    await outreach.changeEnrollment(admin, {
      organizationId: org,
      enrollmentId: enrollment.id,
      version: paused.version,
      command: "resume",
    });
    expect(await due()).toEqual([touch.id]);
  });

  test("due touches are grouped by follow-up", async () => {
    now = Date.parse("2026-10-10T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    await send((await firstTouch(f)).id);
    now += 3 * day;
    await outreach.advanceEnrollments(admin, { organizationId: org });
    const listed = await outreach.dueTouches(admin, {
      organizationId: org,
      productId: f.productId,
    });
    expect(listed.groups.map((group) => group.followUp)).toEqual([0, 1, 2, 3]);
    expect(listed.groups[1]?.touches).toMatchObject([
      {
        relationshipId: f.relationshipId,
        stepNumber: 2,
        person: { id: f.personId },
      },
    ]);
    expect(listed.groups[0]?.touches).toEqual([]);
  });
});

describe("no double send", () => {
  test("a second report is refused with the first report's details", async () => {
    now = Date.parse("2026-10-11T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    await send(touch.id, admin, { externalMessageId: "double-1" });
    const refusal = await send(touch.id, agent).catch((error) => error);
    expect(refusal).toMatchObject({
      code: "TOUCH_ALREADY_SENT",
      status: 409,
      details: {
        sentBy: "Alex Morgan",
        sentById: demoUser,
        sentAt: new Date(now).toISOString(),
        externalMessageId: "double-1",
      },
    });
    expect(t.errors.TOUCH_ALREADY_SENT).toContain("{sentBy}");
    expect((await relationshipRow(f.relationshipId)).touchCount).toBe(1);
  });

  test("two concurrent reports record one send", async () => {
    now = Date.parse("2026-10-12T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const results = await Promise.allSettled([
      send(touch.id, admin),
      send(touch.id, agent),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      code: "TOUCH_ALREADY_SENT",
    });
    expect((await relationshipRow(f.relationshipId)).touchCount).toBe(1);
    expect(
      (
        await local.db
          .select()
          .from(s.changeEvents)
          .where(
            and(
              eq(s.changeEvents.entityId, touch.id),
              eq(s.changeEvents.type, "touch.sent"),
            ),
          )
      ).length,
    ).toBe(1);
  });

  test("a reused message id names the other touch only to someone who can read its brand", async () => {
    now = Date.parse("2026-10-13T08:00:00Z");
    const hidden = await fixture();
    const visible = await fixture(demoId(10));
    const visibleToo = await fixture(demoId(10));
    await enroll(hidden);
    await enroll(visible);
    await enroll(visibleToo);
    const hiddenTouch = await firstTouch(hidden);
    await send(hiddenTouch.id, admin, { externalMessageId: "brand-scoped-id" });
    const refused = await send((await firstTouch(visible)).id, teammate, {
      externalMessageId: "brand-scoped-id",
    }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "EXTERNAL_MESSAGE_REPORTED" });
    expect(refused).not.toHaveProperty("details.touchId");
    await expect(
      send((await firstTouch(visibleToo)).id, admin, {
        externalMessageId: "brand-scoped-id",
      }),
    ).rejects.toMatchObject({
      code: "EXTERNAL_MESSAGE_REPORTED",
      details: { touchId: hiddenTouch.id },
    });
  });

  test("a unique violation on the reported message id is a conflict, not a server error", () => {
    const pglite = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "touches_external_message",
    });
    const postgresJs = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "touches_external_message",
    });
    expect(
      externalMessageConflict(
        Object.assign(new Error("Failed query"), { cause: pglite }),
      ),
    ).toBe(true);
    expect(
      externalMessageConflict(
        Object.assign(new Error("Failed query"), { cause: postgresJs }),
      ),
    ).toBe(true);
    expect(
      externalMessageConflict(
        Object.assign(new Error("Failed query"), {
          cause: { code: "23505", constraint: "touches_enrollment_step" },
        }),
      ),
    ).toBe(false);
    expect(externalMessageConflict(new Error("other"))).toBe(false);
  });

  test("the database refuses a sent touch without a report, a reused message id and a second touch for a step", async () => {
    now = Date.parse("2026-10-13T06:00:00Z");
    const f = await fixture();
    const g = await fixture();
    await enroll(f);
    await enroll(g);
    const touch = await firstTouch(f);
    const other = await firstTouch(g);
    await expect(
      local.db
        .update(s.touches)
        .set({ status: "sent" })
        .where(eq(s.touches.id, touch.id)),
    ).rejects.toThrow();
    await send(touch.id, admin, { externalMessageId: "shared-id" });
    await expect(
      send(other.id, admin, { externalMessageId: "shared-id" }),
    ).rejects.toMatchObject({ code: "EXTERNAL_MESSAGE_REPORTED" });
    await expect(
      local.db
        .update(s.touches)
        .set({
          status: "sent",
          sentBy: demoUser,
          sentAt: new Date(now),
          externalMessageId: "shared-id",
        })
        .where(eq(s.touches.id, other.id)),
    ).rejects.toThrow();
    await expect(
      local.db.insert(s.touches).values({
        organizationId: org,
        productId: touch.productId,
        relationshipId: touch.relationshipId,
        enrollmentId: touch.enrollmentId,
        stepNumber: 1,
        followUp: 0,
        channel: "gmail",
        senderId: demoUser,
        dueAt: new Date(now),
      }),
    ).rejects.toThrow();
  });
});

describe("double send under a stale check", () => {
  test("a report whose check read an unsent row is still refused with the first report's details", async () => {
    now = Date.parse("2026-10-13T08:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const firstAt = new Date(now - 60000);
    type Locked = (
      principal: Principal,
      input: { organizationId: string; touchId: string },
      change: (context: { tx: typeof local.db }) => Promise<unknown>,
    ) => Promise<unknown>;
    const target = OutreachService.prototype as unknown as {
      lockedTouch: Locked;
    };
    const original = target.lockedTouch;
    const spy = vi.spyOn(target, "lockedTouch").mockImplementation(function (
      this: OutreachService,
      principal,
      input,
      change,
    ) {
      return original.call(this, principal, input, async (context) => {
        await context.tx
          .update(s.touches)
          .set({
            status: "sent",
            sentBy: "demo-teammate",
            sentAt: firstAt,
            closedAt: firstAt,
            externalMessageId: "first-report",
          })
          .where(eq(s.touches.id, touch.id));
        return change(context);
      });
    });
    try {
      const refusal = await send(touch.id).catch((error) => error);
      expect(refusal).toMatchObject({
        code: "TOUCH_ALREADY_SENT",
        details: {
          sentBy: "Sam Rivera",
          sentById: "demo-teammate",
          sentAt: firstAt.toISOString(),
          externalMessageId: "first-report",
        },
      });
    } finally {
      spy.mockRestore();
    }
    expect((await relationshipRow(f.relationshipId)).touchCount).toBe(0);
  });
});

describe("planner timing and idempotence", () => {
  test("the next touch appears only after the delay from the send, once, and the enrollment completes", async () => {
    now = Date.parse("2026-10-14T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    await outreach.advanceEnrollments(admin, { organizationId: org });
    await outreach.advanceEnrollments(admin, { organizationId: org });
    expect(await touchesOf(f.relationshipId)).toHaveLength(1);
    const sentAt = now;
    await send((await firstTouch(f)).id);
    now = sentAt + 3 * day - 1;
    await outreach.advanceEnrollments(admin, { organizationId: org });
    expect(await touchesOf(f.relationshipId)).toHaveLength(1);
    now = sentAt + 3 * day;
    await outreach.advanceEnrollments(admin, { organizationId: org });
    await outreach.advanceEnrollments(admin, { organizationId: org });
    const [, second] = await touchesOf(f.relationshipId);
    expect(second).toMatchObject({
      stepNumber: 2,
      followUp: 1,
      dueAt: new Date(sentAt + 3 * day),
      draft: "Fictional template 2",
    });
    expect(await touchesOf(f.relationshipId)).toHaveLength(2);
    for (const step of [2, 3, 4]) {
      const touch = (await touchesOf(f.relationshipId)).find(
        (row) => row.stepNumber === step,
      );
      if (!touch) throw new Error(`missing step ${step}`);
      await send(touch.id);
      now += 5 * day;
      await outreach.advanceEnrollments(admin, { organizationId: org });
    }
    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "completed",
    });
    expect(
      (await touchesOf(f.relationshipId)).map((row) => row.status),
    ).toEqual(["sent", "sent", "sent", "sent"]);
  });
});

describe("contact rules", () => {
  test("approve refuses do not contact, and setting it pauses every brand", async () => {
    now = Date.parse("2026-10-15T06:00:00Z");
    const f = await fixture();
    const second = await product();
    const linked = await crm.createPerson(admin, {
      organizationId: org,
      productId: second.id,
      personId: f.personId,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const secondSequence = await addSequence(second.id);
    await enroll(f);
    await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: secondSequence.id,
      relationshipIds: [linked.relationshipId],
      dryRun: false,
    });
    const touch = await firstTouch(f);
    const approved = await draftAndApprove(touch.id);
    const person = await personRow(f.personId);
    await outreach.setContactPreferences(admin, {
      organizationId: org,
      personId: person.id,
      version: person.version,
      doNotContact: true,
      timeZone: null,
    });
    for (const relationshipId of [f.relationshipId, linked.relationshipId])
      expect(await enrollmentOf(relationshipId)).toMatchObject({
        status: "paused",
        pauseReason: "do_not_contact",
      });
    expect(await touchRow(touch.id)).toMatchObject({
      status: "drafted",
      approvedHash: null,
      version: approved.version + 1,
    });
    await local.db
      .update(s.enrollments)
      .set({ status: "running", pauseReason: null })
      .where(eq(s.enrollments.relationshipId, f.relationshipId));
    await expect(
      outreach.approve(admin, {
        organizationId: org,
        touchId: touch.id,
        version: approved.version + 1,
      }),
    ).rejects.toMatchObject({ code: "DO_NOT_CONTACT" });
    await expect(send(touch.id)).rejects.toMatchObject({
      code: "DO_NOT_CONTACT",
    });
    expect(
      await outreach.advanceEnrollments(admin, { organizationId: org }),
    ).toMatchObject({ paused: 1 });
    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "paused",
      pauseReason: "do_not_contact",
    });
    const paused = await enrollmentOf(f.relationshipId);
    await expect(
      outreach.changeEnrollment(admin, {
        organizationId: org,
        enrollmentId: paused.id,
        version: paused.version,
        command: "resume",
      }),
    ).rejects.toMatchObject({ code: "DO_NOT_CONTACT" });
  });

  test("a cooldown from another brand moves the planned due time and gates the send, not the approval", async () => {
    now = Date.parse("2026-10-16T06:00:00Z");
    const f = await fixture();
    const second = await product();
    const linked = await crm.createPerson(admin, {
      organizationId: org,
      productId: second.id,
      personId: f.personId,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const secondSequence = await addSequence(second.id);
    await enroll(f);
    await send((await firstTouch(f)).id);
    const sentAt = now;
    now += day;
    await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: secondSequence.id,
      relationshipIds: [linked.relationshipId],
      dryRun: false,
    });
    const [planned] = await touchesOf(linked.relationshipId);
    if (!planned) throw new Error("missing touch");
    const until = new Date(sentAt + 3 * day).toISOString();
    expect(planned.dueAt).toEqual(new Date(sentAt + 3 * day));
    const approved = await draftAndApprove(planned.id);
    expect(approved.status).toBe("approved");
    expect(await sendGate(local.db, approved, now)).toEqual({
      allowed: false,
      sendAfter: sentAt + 3 * day,
      reasons: [{ code: "CONTACT_COOLDOWN", until: sentAt + 3 * day }],
    });
    expect(
      await outreach.touch(admin, { organizationId: org, touchId: planned.id }),
    ).toMatchObject({
      sendAfter: until,
      reasons: [{ code: "CONTACT_COOLDOWN", until }],
    });
    const reported = await send(planned.id);
    expect(reported.warnings).toEqual(["cooldown"]);
    expect(reported.touch.sentWarnings).toEqual(["cooldown"]);
  });

  test("the daily cap per sender counts the workspace calendar day and gates the send until the next one", async () => {
    now = Date.parse("2026-10-17T06:00:00Z");
    await setRules({ dailyCapPerSender: 1 });
    try {
      const f = await fixture();
      const g = await fixture();
      await enroll(f);
      await enroll(g);
      await send((await firstTouch(f)).id);
      const touch = await firstTouch(g);
      const approved = await draftAndApprove(touch.id);
      expect(approved.status).toBe("approved");
      expect(await sendGate(local.db, approved, now)).toEqual({
        allowed: false,
        sendAfter: Date.parse("2026-10-18T02:30:00Z"),
        reasons: [{ code: "DAILY_CAP_REACHED", cap: 1 }],
      });
      const due = await outreach.dueTouches(admin, {
        organizationId: org,
        productId: g.productId,
      });
      expect(
        due.groups[0]?.touches.find((row) => row.id === touch.id),
      ).toMatchObject({
        sendAfter: "2026-10-18T02:30:00.000Z",
        reasons: [{ code: "DAILY_CAP_REACHED", cap: 1 }],
      });
      const reported = await send(touch.id);
      expect(reported.warnings).toContain("daily_cap");
      now = Date.parse("2026-10-17T18:31:00Z");
      const h = await fixture();
      await enroll(h);
      const tz = await personRow(h.personId);
      await outreach.setContactPreferences(admin, {
        organizationId: org,
        personId: tz.id,
        version: tz.version,
        doNotContact: false,
        timeZone: "America/Los_Angeles",
      });
      expect(await sendGate(local.db, await firstTouch(h), now)).toEqual({
        allowed: true,
        sendAfter: now,
        reasons: [],
      });
    } finally {
      await setRules({ dailyCapPerSender: 40 });
    }
  });

  test("quiet hours follow the person's zone, move planned touches and gate the send, not the approval", async () => {
    now = Date.parse("2026-10-18T16:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    expect(touch.dueAt).toEqual(new Date("2026-10-19T02:30:00Z"));
    const approved = await draftAndApprove(touch.id);
    expect(approved.status).toBe("approved");
    expect(await sendGate(local.db, approved, now)).toEqual({
      allowed: false,
      sendAfter: Date.parse("2026-10-19T02:30:00Z"),
      reasons: [
        { code: "QUIET_HOURS", until: Date.parse("2026-10-19T02:30:00Z") },
      ],
    });
    const person = await personRow(f.personId);
    await outreach.setContactPreferences(admin, {
      organizationId: org,
      personId: person.id,
      version: person.version,
      doNotContact: false,
      timeZone: "Europe/London",
    });
    expect(await sendGate(local.db, approved, now)).toMatchObject({
      allowed: true,
    });
    await local.db
      .update(s.people)
      .set({ timeZone: null })
      .where(eq(s.people.id, person.id));
    const reported = await send(touch.id);
    expect(reported.warnings).toEqual(["quiet_hours"]);
  });

  test("one planner run spaces a person's touches across brands by the cooldown", async () => {
    now = Date.parse("2026-10-19T06:00:00Z");
    const f = await fixture();
    const second = await product();
    const linked = await crm.createPerson(admin, {
      organizationId: org,
      productId: second.id,
      personId: f.personId,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const secondSequence = await addSequence(second.id);
    await local.db.insert(s.enrollments).values([
      {
        organizationId: org,
        productId: f.productId,
        relationshipId: f.relationshipId,
        sequenceId: f.sequenceId,
        status: "running",
        enrolledAt: new Date(now),
      },
      {
        organizationId: org,
        productId: second.id,
        relationshipId: linked.relationshipId,
        sequenceId: secondSequence.id,
        status: "running",
        enrolledAt: new Date(now),
      },
    ]);
    await outreach.advanceEnrollments(admin, { organizationId: org });
    const due = [
      ...(await touchesOf(f.relationshipId)),
      ...(await touchesOf(linked.relationshipId)),
    ]
      .map((touch) => touch.dueAt.getTime())
      .sort((a, b) => a - b);
    expect(due).toEqual([now, now + 3 * day]);
  });

  test("person time zones use the workspace IANA schema and still accept legacy aliases", async () => {
    const f = await fixture();
    const person = await personRow(f.personId);
    const { contactPreferencesSchema } = await import(
      "../packages/core/outreach"
    );
    const accepts = (timeZone: string | null) =>
      contactPreferencesSchema.safeParse({
        organizationId: org,
        personId: person.id,
        version: person.version,
        doNotContact: false,
        timeZone,
      }).success;
    for (const zone of ["Mars/Olympus", "+05:30", "-0800", ""])
      expect(accepts(zone), zone).toBe(false);
    for (const zone of [
      "Asia/Kolkata",
      "Asia/Calcutta",
      "US/Pacific",
      "UTC",
      null,
    ])
      expect(accepts(zone), String(zone)).toBe(true);
  });

  test("a do not contact change without a time zone keeps the stored one", async () => {
    const f = await fixture();
    await local.db
      .update(s.people)
      .set({ timeZone: "+05:30" })
      .where(eq(s.people.id, f.personId));
    const person = await personRow(f.personId);
    await outreach.setContactPreferences(admin, {
      organizationId: org,
      personId: person.id,
      version: person.version,
      doNotContact: true,
    });
    const updated = await personRow(f.personId);
    expect(updated.doNotContact).toBe(true);
    expect(updated.timeZone).toBe("+05:30");
  });

  test("only admins change the rules, with a version check", async () => {
    const current = await outreach.contactRules(teammate, org);
    await expect(
      outreach.updateContactRules(teammate, {
        organizationId: org,
        version: current.version,
        cooldownDays: 1,
        dailyCapPerSender: 5,
        quietHoursStart: 21,
        quietHoursEnd: 7,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outreach.updateContactRules(admin, {
        organizationId: org,
        version: current.version + 5,
        cooldownDays: 1,
        dailyCapPerSender: 5,
        quietHoursStart: 21,
        quietHoursEnd: 7,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("pausing on reply", () => {
  test("a reply on one brand pauses the person's sequences in every brand and records the inbound time", async () => {
    now = Date.parse("2026-10-20T06:00:00Z");
    const f = await fixture();
    const second = await product();
    const linked = await crm.createPerson(admin, {
      organizationId: org,
      productId: second.id,
      personId: f.personId,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const secondSequence = await addSequence(second.id);
    await enroll(f);
    await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: secondSequence.id,
      relationshipIds: [linked.relationshipId],
      dryRun: false,
    });
    const approved = await draftAndApprove(
      (await touchesOf(linked.relationshipId))[0]?.id ?? "",
    );
    await local.db.insert(s.conversations).values({
      organizationId: org,
      productId: f.productId,
      relationshipId: f.relationshipId,
      connectionId: demoId(700),
      externalThreadId: "reply-across-brands",
      ownerId: demoUser,
      visibility: "product",
      channel: "gmail",
    });
    const occurredAt = "2026-10-20T07:00:00.000Z";
    await ingestReply(local.db, {
      provider: "gmail",
      accountId: "demo-gmail",
      messageId: "reply-across-brands-1",
      threadId: "reply-across-brands",
      direction: "inbound",
      channel: "gmail",
      body: "Fictional reply",
      occurredAt,
    });
    for (const relationshipId of [f.relationshipId, linked.relationshipId]) {
      expect(await enrollmentOf(relationshipId)).toMatchObject({
        status: "paused",
        pauseReason: "reply",
      });
      expect((await relationshipRow(relationshipId)).lastInboundAt).toEqual(
        new Date(occurredAt),
      );
    }
    expect(await touchRow(approved.id)).toMatchObject({
      status: "drafted",
      approvedHash: null,
    });
  });

  test("a reply from a secondary email pauses the person, case-insensitively and only in that workspace", async () => {
    now = Date.parse("2026-10-21T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const person = await personRow(f.personId);
    await records.updatePerson(admin, {
      organizationId: org,
      productId: f.productId,
      personId: person.id,
      version: person.version,
      name: person.name,
      title: "",
      email: person.email,
      otherEmails: ["second.address@example.test"],
      phone: "",
      linkedinUrl: "",
      summary: "",
    });
    const [outsider] = await local.db
      .insert(s.people)
      .values({
        organizationId: demoId(2),
        name: "Other workspace person",
        email: "second.address@example.test",
      })
      .returning();
    const [outsiderRelationship] = await local.db
      .insert(s.relationships)
      .values({
        organizationId: demoId(2),
        productId: demoId(13),
        personId: outsider?.id ?? "",
        ownerId: demoUser,
      })
      .returning();
    const result = await ingestReply(local.db, {
      provider: "gmail",
      accountId: "demo-gmail",
      messageId: "secondary-reply-1",
      threadId: "unknown-thread-for-secondary",
      direction: "inbound",
      channel: "gmail",
      body: "Fictional reply",
      occurredAt: "2026-10-21T07:00:00.000Z",
      from: "Second.Address@Example.TEST",
    });
    expect(result).toEqual({ duplicate: false, matched: false });
    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "paused",
      pauseReason: "reply",
    });
    expect(
      (await relationshipRow(outsiderRelationship?.id ?? "")).lastInboundAt,
    ).toBeNull();
  });
});

describe("approval follows merge fields", () => {
  test("renaming the person, changing their title or company, or renaming the company clears an approved touch", async () => {
    now = Date.parse("2026-10-21T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    await draftAndApprove(touch.id);
    const reapprove = async () => {
      const current = await touchRow(touch.id);
      expect(current).toMatchObject({ status: "drafted", approvedHash: null });
      return outreach.approve(admin, {
        organizationId: org,
        touchId: touch.id,
        version: current.version,
      });
    };
    const editPerson = async (changes: object) => {
      const person = await personRow(f.personId);
      return records.updatePerson(
        admin,
        personUpdateSchema.parse({
          organizationId: org,
          productId: f.productId,
          personId: person.id,
          version: person.version,
          name: person.name,
          title: person.title,
          email: person.email,
          companyId: person.companyId,
          ...changes,
        }),
      );
    };
    await editPerson({});
    expect(await touchRow(touch.id)).toMatchObject({ status: "approved" });
    await editPerson({ name: "Renamed fixture person" });
    await reapprove();
    await editPerson({ title: "Fictional new title" });
    await reapprove();
    const company = await records.saveCompany(
      admin,
      companySchema.parse({
        organizationId: org,
        name: "Fictional Merge Field Co",
      }),
    );
    await editPerson({ companyId: company.id });
    await reapprove();
    await records.saveCompany(
      admin,
      companySchema.parse({
        organizationId: org,
        companyId: company.id,
        version: company.version,
        name: "Fictional Renamed Co",
      }),
    );
    const approved = await reapprove();
    expect(approved.status).toBe("approved");
  });
});

describe("editing a sequence", () => {
  test("removing the final unfinished step completes the enrollment and expires its approved touch", async () => {
    now = Date.parse("2026-10-22T06:00:00Z");
    const f = await fixture();
    const sequence = await outreach.updateSequence(admin, {
      organizationId: org,
      sequenceId: f.sequenceId,
      version: 1,
      steps: steps.slice(0, 2).map((step) => ({ ...step, delayDays: 0 })),
    });
    await enroll(f);
    const first = await firstTouch(f);
    await outreach.skip(admin, {
      organizationId: org,
      touchId: first.id,
      version: first.version,
      reason: "Fictional skipped introduction",
    });
    const second = (await touchesOf(f.relationshipId))[1];
    if (!second) throw new Error("missing second touch");
    const drafted = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: second.id,
      version: second.version,
      draft: "Subject: Fictional review\n\nReviewed follow-up.",
    });
    const approved = await outreach.approve(admin, {
      organizationId: org,
      touchId: second.id,
      version: drafted.version,
    });
    expect(approved.status).toBe("approved");

    await outreach.updateSequence(admin, {
      organizationId: org,
      sequenceId: f.sequenceId,
      version: sequence.sequence.version,
      steps: sequence.sequence.steps.slice(0, 1),
    });

    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "completed",
    });
    expect(await touchRow(second.id)).toMatchObject({
      status: "expired",
      draft: drafted.draft,
      approvedHash: null,
      approvedBy: null,
    });
  });

  test("only planned touches change, removed steps expire their planned touch, and the version bumps", async () => {
    now = Date.parse("2026-10-22T06:00:00Z");
    const brand = await product();
    const f = await fixture(brand.id);
    const g = await fixture(brand.id);
    const [sequence] = await local.db
      .select()
      .from(s.sequences)
      .where(eq(s.sequences.id, f.sequenceId));
    if (!sequence) throw new Error("missing sequence");
    await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: sequence.id,
      relationshipIds: [f.relationshipId, g.relationshipId],
      dryRun: false,
    });
    const drafted = await outreach.editDraft(admin, {
      organizationId: org,
      touchId: (await firstTouch(g)).id,
      version: (await firstTouch(g)).version,
      draft: "Hand written",
    });
    const updated = await outreach.updateSequence(admin, {
      organizationId: org,
      sequenceId: sequence.id,
      version: sequence.version,
      steps: steps.map((step) =>
        step.number === 1
          ? { ...step, template: "New template", channel: "linkedin" as const }
          : step,
      ),
    });
    expect(updated.sequence.version).toBe(sequence.version + 1);
    expect(updated.changedTouches).toBe(1);
    expect(await firstTouch(f)).toMatchObject({
      status: "planned",
      draft: "New template",
      channel: "linkedin",
    });
    expect(await firstTouch(g)).toMatchObject({
      status: "drafted",
      draft: "Hand written",
      channel: "gmail",
      version: drafted.version,
    });
    await expect(
      outreach.updateSequence(admin, {
        organizationId: org,
        sequenceId: sequence.id,
        version: sequence.version,
        steps,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await outreach.updateSequence(admin, {
      organizationId: org,
      sequenceId: sequence.id,
      version: updated.sequence.version,
      steps: steps.filter((step) => step.number !== 1),
    });
    expect(await firstTouch(f)).toMatchObject({ status: "expired" });
    expect(await firstTouch(g)).toMatchObject({ status: "drafted" });
  });
});

describe("relationship stages", () => {
  test("moves go only to outreach stages of the same brand, won only when asked", async () => {
    const f = await fixture();
    const relationship = await relationshipRow(f.relationshipId);
    const stages = await local.db
      .select()
      .from(s.stages)
      .where(eq(s.stages.productId, f.productId));
    const won = stages.find(
      (stage) => stage.pipeline === "outreach" && stage.category === "won",
    );
    const deal = stages.find((stage) => stage.pipeline === "deal");
    const elsewhere = await local.db
      .select()
      .from(s.stages)
      .where(eq(s.stages.productId, demoId(10)));
    await expect(
      outreach.changeRelationship(admin, {
        organizationId: org,
        relationshipId: relationship.id,
        version: relationship.version,
        stageId: deal?.id ?? "",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outreach.changeRelationship(admin, {
        organizationId: org,
        relationshipId: relationship.id,
        version: relationship.version,
        stageId: elsewhere[0]?.id ?? "",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const moved = await outreach.changeRelationship(admin, {
      organizationId: org,
      relationshipId: relationship.id,
      version: relationship.version,
      stageId: won?.id ?? "",
      priority: "high",
      nextStep: "Send the fictional proposal",
      nextStepDueAt: "2026-11-01T09:00:00.000Z",
    });
    expect(moved).toMatchObject({
      stageId: won?.id,
      priority: "high",
      nextStep: "Send the fictional proposal",
      nextStepDueAt: new Date("2026-11-01T09:00:00.000Z"),
      version: relationship.version + 1,
    });
  });
});

describe("tenant isolation", () => {
  test("another workspace cannot see a touch and a member cannot reach brands they cannot read", async () => {
    now = Date.parse("2026-10-23T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    await expect(
      outreach.touch(admin, { organizationId: demoId(2), touchId: touch.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      send(touch.id, { ...admin, organizationId: demoId(2) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outreach.touch(restricted, { organizationId: org, touchId: touch.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(send(touch.id, restricted)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      outreach.touch(admin, {
        organizationId: org,
        productId: demoId(11),
        touchId: touch.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const listed = await outreach.dueTouches(restricted, {
      organizationId: org,
    });
    expect(
      listed.groups.flatMap((group) => group.touches).map((row) => row.id),
    ).not.toContain(touch.id);
    const context = await outreach.touch(admin, {
      organizationId: org,
      touchId: touch.id,
    });
    expect(context).toMatchObject({
      touch: { id: touch.id },
      person: { id: f.personId },
      step: { number: 1 },
      timeZone: "Asia/Kolkata",
    });
  });

  test("listing due touches plans nothing, and a restricted member's advance plans no touches in a brand they cannot read", async () => {
    now = Date.parse("2026-10-23T06:00:00Z");
    const hidden = await fixture();
    await local.db.insert(s.enrollments).values({
      organizationId: org,
      productId: hidden.productId,
      relationshipId: hidden.relationshipId,
      sequenceId: hidden.sequenceId,
      status: "running",
      enrolledAt: new Date(now),
    });
    await outreach.dueTouches(admin, { organizationId: org });
    expect(await touchesOf(hidden.relationshipId)).toEqual([]);
    await outreach.advanceEnrollments(restricted, { organizationId: org });
    expect(await touchesOf(hidden.relationshipId)).toEqual([]);
    await expect(
      outreach.advanceEnrollments(
        { ...agent, readOnly: true },
        { organizationId: org },
      ),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      outreach.advanceEnrollments(
        { ...admin, readOnly: true },
        { organizationId: org },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await touchesOf(hidden.relationshipId)).toEqual([]);
    await outreach.advanceEnrollments(admin, { organizationId: org });
    expect(await touchesOf(hidden.relationshipId)).toHaveLength(1);
  });

  test("an archived person's touches refuse every write after the status reshape", async () => {
    now = Date.parse("2026-10-24T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const person = await personRow(f.personId);
    const archived = await records.archivePerson(admin, {
      organizationId: org,
      personId: person.id,
      version: person.version,
      archived: true,
    });
    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "paused",
      pauseReason: "archived",
    });
    await expect(send(touch.id)).rejects.toMatchObject({
      code: "RECORD_ARCHIVED",
    });
    await expect(
      outreach.skip(admin, {
        organizationId: org,
        touchId: touch.id,
        version: touch.version,
        reason: "Archived",
      }),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await records.archivePerson(admin, {
      organizationId: org,
      personId: person.id,
      version: archived.version,
      archived: false,
    });
    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "paused",
      pauseReason: "archived",
    });
  });
});

describe("views for the outreach section", () => {
  test("the queue lists drafts, approved and recent sends, and paused enrollments with an archived flag", async () => {
    now = Date.parse("2026-10-27T10:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const scope = { organizationId: org, productId: f.productId };
    const first = await outreach.queue(admin, scope);
    expect(first.drafts.map((row) => row.id)).toEqual([touch.id]);
    expect(first.drafts[0]).toMatchObject({
      status: "planned",
      followUp: 0,
      person: { id: f.personId, archived: false },
      sequenceName: "Fixture sequence",
    });
    expect(first.approved).toEqual([]);
    await draftAndApprove(touch.id);
    const approved = await outreach.queue(admin, scope);
    expect(approved.drafts).toEqual([]);
    expect(approved.approved[0]).toMatchObject({
      id: touch.id,
      allowed: true,
      sendAfter: new Date(now).toISOString(),
    });
    await send(touch.id, admin, { externalMessageId: "queue-link-1" });
    const sent = await outreach.queue(admin, scope);
    expect(sent.approved).toEqual([]);
    expect(sent.sent[0]).toMatchObject({
      id: touch.id,
      externalMessageId: "queue-link-1",
      sentByName: "Alex Morgan",
    });
    const enrollment = await enrollmentOf(f.relationshipId);
    await outreach.changeEnrollment(admin, {
      organizationId: org,
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command: "pause",
    });
    const paused = await outreach.queue(admin, scope);
    expect(paused.paused).toMatchObject([
      {
        id: enrollment.id,
        pauseReason: "manual",
        sequenceName: "Fixture sequence",
        person: { id: f.personId, archived: false },
      },
    ]);
    const person = await personRow(f.personId);
    await records.archivePerson(admin, {
      organizationId: org,
      personId: person.id,
      version: person.version,
      archived: true,
    });
    const archived = await outreach.queue(admin, scope);
    expect(archived.paused[0]?.person.archived).toBe(true);
    expect(
      (await outreach.queue(teammate, { organizationId: org })).paused.some(
        (row) => row.id === enrollment.id,
      ),
    ).toBe(false);
  });

  test("a skip can be undone: the touch reopens, an untouched next step is withdrawn and the step can be skipped again", async () => {
    now = Date.parse("2026-10-28T06:00:00Z");
    const f = await fixture();
    await enroll(f);
    const touch = await firstTouch(f);
    const skipped = await outreach.skip(admin, {
      organizationId: org,
      touchId: touch.id,
      version: touch.version,
      reason: "Met in person",
    });
    now += 3 * day;
    await outreach.advanceEnrollments(admin, { organizationId: org });
    expect(await touchesOf(f.relationshipId)).toHaveLength(2);
    const withdrawn = (await touchesOf(f.relationshipId))[1];
    const reopened = await outreach.reopen(admin, {
      organizationId: org,
      touchId: touch.id,
      version: skipped.version,
    });
    expect(reopened).toMatchObject({
      status: "drafted",
      skipReason: null,
      closedAt: null,
    });
    expect(await touchesOf(f.relationshipId)).toMatchObject([
      { stepNumber: 1, status: "drafted" },
    ]);
    expect(
      await local.db
        .select()
        .from(s.changeEvents)
        .where(
          and(
            eq(s.changeEvents.entityId, withdrawn?.id ?? ""),
            eq(s.changeEvents.type, "touch.withdrawn"),
          ),
        ),
    ).toMatchObject([
      { organizationId: org, productId: f.productId, actorId: demoUser },
    ]);
    expect(await enrollmentOf(f.relationshipId)).toMatchObject({
      status: "running",
      step: 1,
    });
    await expect(
      outreach.reopen(admin, {
        organizationId: org,
        touchId: touch.id,
        version: reopened.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const again = await outreach.skip(admin, {
      organizationId: org,
      touchId: touch.id,
      version: reopened.version,
      reason: "Met in person",
    });
    now += 3 * day;
    await outreach.advanceEnrollments(admin, { organizationId: org });
    const next = (await touchesOf(f.relationshipId))[1];
    if (!next) throw new Error("missing next touch");
    await outreach.editDraft(admin, {
      organizationId: org,
      touchId: next.id,
      version: next.version,
      draft: "Edited by hand",
    });
    await expect(
      outreach.reopen(admin, {
        organizationId: org,
        touchId: touch.id,
        version: again.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("saving a sequence reports how many planned touches changed", async () => {
    now = Date.parse("2026-10-30T06:00:00Z");
    const brand = (await product()).id;
    const f = await fixture(brand);
    const g = await fixture(brand);
    const sequence = await addSequence(brand);
    await outreach.enroll(admin, {
      organizationId: org,
      sequenceId: sequence.id,
      relationshipIds: [f.relationshipId, g.relationshipId],
      dryRun: false,
    });
    const unchanged = await outreach.updateSequence(admin, {
      organizationId: org,
      sequenceId: sequence.id,
      version: sequence.version,
      steps,
    });
    expect(unchanged.changedTouches).toBe(0);
    const edited = await outreach.updateSequence(admin, {
      organizationId: org,
      sequenceId: sequence.id,
      version: unchanged.sequence.version,
      steps: steps.map((step) =>
        step.number === 1 ? { ...step, template: "Rewritten" } : step,
      ),
    });
    expect(edited.changedTouches).toBe(2);
    expect(edited.sequence.version).toBe(sequence.version + 2);
  });
});
