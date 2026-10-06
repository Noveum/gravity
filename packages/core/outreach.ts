import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { zonedDayBounds } from "./calendar";
import { scopeSchema } from "./crm";
import { draftHash, draftSubject } from "./drafts";
import { assertProductAccess, reassignTouches } from "./members";
import { planEnrollment } from "./outreach-planner";
import {
  type ContactRules,
  type ContactViolation,
  contactViolations,
  defaultContactRules,
  loosensContactRules,
  sendWindow,
} from "./outreach-rules";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import {
  emptyRelationshipDetails,
  fitsRelationshipInput,
  relationshipDetailsPatchSchema,
  relationshipDetailsSchema,
} from "./relationship-context";
import {
  assertActiveRelationships,
  clearApprovals,
  personVisible,
  shareLockStage,
} from "./visibility";
import { ianaTimeZoneSchema } from "./workspace";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;
type Touch = typeof s.touches.$inferSelect;
type Enrollment = typeof s.enrollments.$inferSelect;
type Step = (typeof s.sequences.$inferSelect)["steps"][number];

const version = z.number().int().positive();
const touchScope = scopeSchema.extend({ touchId: z.uuid() });

export const enrollSchema = scopeSchema.extend({
  sequenceId: z.uuid(),
  relationshipIds: z.array(z.uuid()).min(1).max(200),
  dryRun: z.boolean().default(false),
});
export const touchQuerySchema = touchScope;
export const touchDraftSchema = touchScope.extend({
  version,
  draft: z.string().max(20000),
});
export const touchApproveSchema = touchScope.extend({ version });
export const touchSentSchema = touchScope.extend({
  version: version.optional(),
  sentAt: z.iso.datetime().optional(),
  externalMessageId: z.string().trim().min(1).max(500).optional(),
});
export const touchReopenSchema = touchScope.extend({ version });
export const touchSkipSchema = touchScope.extend({
  version,
  reason: z.string().trim().min(1).max(500),
});
export const touchSnoozeSchema = touchScope.extend({
  version,
  dueAt: z.iso.datetime(),
});
export const enrollmentChangeSchema = scopeSchema.extend({
  enrollmentId: z.uuid(),
  version,
  command: z.enum(["pause", "resume", "stop"]),
});
export const relationshipChangeSchema = scopeSchema
  .extend({
    relationshipId: z.uuid(),
    version,
    context: z.string().trim().max(10000).optional(),
    contextDetails: relationshipDetailsPatchSchema.optional(),
    stageId: z.uuid().optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    nextStep: z.string().trim().max(500).optional(),
    nextStepDueAt: z.iso.datetime().nullable().optional(),
    ownerId: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (value) =>
      value.context !== undefined ||
      value.contextDetails !== undefined ||
      value.stageId !== undefined ||
      value.priority !== undefined ||
      value.nextStep !== undefined ||
      value.nextStepDueAt !== undefined ||
      value.ownerId !== undefined,
  )
  .refine(fitsRelationshipInput);
const stepSchema = z.object({
  number: z.number().int().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  delayDays: z.number().int().min(0).max(365),
  channel: z.enum(["gmail", "linkedin"]),
  template: z.string().max(20000).default(""),
  followUp: z.number().int().min(0).max(3),
});
export const sequenceUpdateSchema = scopeSchema.extend({
  sequenceId: z.uuid(),
  version,
  name: z.string().trim().min(1).max(100).optional(),
  steps: z
    .array(stepSchema)
    .min(1)
    .max(10)
    .refine(
      (steps) =>
        new Set(steps.map((step) => step.number)).size === steps.length,
    ),
});
export const sequenceCreateSchema = scopeSchema.extend({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  steps: sequenceUpdateSchema.shape.steps,
});
export const sequenceArchiveSchema = scopeSchema.extend({
  sequenceId: z.uuid(),
  version,
});
export const sequenceRestoreSchema = sequenceArchiveSchema;
export const contactRulesSchema = z.object({
  organizationId: z.uuid(),
  version: z.number().int().min(0),
  cooldownDays: z.number().int().min(0).max(365),
  dailyCapPerSender: z.number().int().min(1).max(10000),
  quietHoursStart: z.number().int().min(0).max(23),
  quietHoursEnd: z.number().int().min(0).max(23),
});
export const contactPreferencesSchema = scopeSchema.extend({
  personId: z.uuid(),
  version,
  doNotContact: z.boolean(),
  timeZone: ianaTimeZoneSchema.nullable().optional(),
});

const openStatuses = ["planned", "drafted", "approved"] as const;
const sentWindowDays = 30;
const day = 86400000;
const isOpen = (touch: Touch) =>
  (openStatuses as readonly string[]).includes(touch.status);

function requireWriteActor(principal: Principal) {
  if (principal.source === "mcp" && principal.readOnly !== false)
    throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
}

const warningFor: Record<ContactViolation["code"], string> = {
  DO_NOT_CONTACT: "do_not_contact",
  CONTACT_COOLDOWN: "cooldown",
  DAILY_CAP_REACHED: "daily_cap",
  QUIET_HOURS: "quiet_hours",
};

async function sentReport(db: Reader, touch: Touch) {
  const [reporter] = touch.sentBy
    ? await db
        .select({ name: s.user.name })
        .from(s.user)
        .where(eq(s.user.id, touch.sentBy))
    : [];
  return new DomainError("TOUCH_ALREADY_SENT", 409, {
    sentBy: reporter?.name ?? touch.sentBy ?? "",
    sentById: touch.sentBy ?? "",
    sentAt: touch.sentAt?.toISOString() ?? "",
    ...(touch.externalMessageId
      ? { externalMessageId: touch.externalMessageId }
      : {}),
  });
}

export function externalMessageConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const fields = error as {
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };
  if (
    fields.code === "23505" &&
    (fields.constraint === "touches_external_message" ||
      fields.constraint_name === "touches_external_message")
  )
    return true;
  return externalMessageConflict(fields.cause);
}

async function assertTouchOpen(db: Reader, touch: Touch) {
  if (touch.status === "sent") throw await sentReport(db, touch);
  if (!isOpen(touch)) throw new DomainError("TOUCH_CLOSED", 409);
  const [delivery] = await db
    .select({ id: s.deliveries.id })
    .from(s.deliveries)
    .where(
      and(
        eq(s.deliveries.touchId, touch.id),
        inArray(s.deliveries.status, ["sending", "unknown", "accepted"]),
      ),
    );
  if (delivery) throw new DomainError("DELIVERY_IN_PROGRESS", 409);
}

export async function readContactRules(db: Reader, organizationId: string) {
  const [row] = await db
    .select()
    .from(s.contactRules)
    .where(eq(s.contactRules.organizationId, organizationId));
  const rules: ContactRules = row
    ? {
        cooldownDays: row.cooldownDays,
        dailyCapPerSender: row.dailyCapPerSender,
        quietHoursStart: row.quietHoursStart,
        quietHoursEnd: row.quietHoursEnd,
      }
    : defaultContactRules;
  return { ...rules, version: row?.version ?? 0 };
}

async function workspaceZone(db: Reader, organizationId: string) {
  const [organization] = await db
    .select({ timezone: s.organizations.timezone })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  return organization?.timezone ?? "UTC";
}

async function unblocksNow(
  db: Reader,
  organizationId: string,
  now: number,
  zones: { before: string | null; after: string | null },
) {
  const [rules, zone] = await Promise.all([
    readContactRules(db, organizationId),
    workspaceZone(db, organizationId),
  ]);
  const blocked = (timeZone: string | null) =>
    contactViolations({
      now,
      doNotContact: false,
      timeZone: timeZone ?? zone,
      lastContactAt: null,
      sentTodayBySender: 0,
      rules,
    }).length > 0;
  return blocked(zones.before) && !blocked(zones.after);
}

async function lastContacts(
  db: Reader,
  organizationId: string,
  personIds: readonly string[],
) {
  if (!personIds.length) return new Map<string, number>();
  const rows = await db
    .select({
      personId: s.relationships.personId,
      last: max(s.relationships.lastOutboundAt),
    })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        inArray(s.relationships.personId, [...personIds]),
      ),
    )
    .groupBy(s.relationships.personId);
  return new Map(
    rows.flatMap((row) =>
      row.last ? [[row.personId, row.last.getTime()] as const] : [],
    ),
  );
}

async function sentOnDay(
  db: Reader,
  organizationId: string,
  senderId: string,
  instant: number,
  zone: string,
) {
  const [start, end] = zonedDayBounds(instant, zone);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.touches)
    .where(
      and(
        eq(s.touches.organizationId, organizationId),
        eq(s.touches.senderId, senderId),
        eq(s.touches.status, "sent"),
        gte(s.touches.sentAt, new Date(start)),
        lt(s.touches.sentAt, new Date(end)),
      ),
    );
  const [reservations] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.deliveries)
    .where(
      and(
        eq(s.deliveries.organizationId, organizationId),
        eq(s.deliveries.ownerId, senderId),
        or(
          inArray(s.deliveries.status, ["sending", "unknown", "accepted"]),
          and(eq(s.deliveries.status, "sent"), isNull(s.deliveries.touchId)),
        ),
        gte(s.deliveries.createdAt, new Date(start)),
        lt(s.deliveries.createdAt, new Date(end)),
      ),
    );
  return (row?.count ?? 0) + (reservations?.count ?? 0);
}

async function expireOpenTouches(
  db: Reader,
  principal: Principal,
  enrollment: Enrollment,
  now: Date,
  stepNumbers?: readonly number[],
) {
  const conditions: SQL[] = [
    eq(s.touches.organizationId, enrollment.organizationId),
    eq(s.touches.enrollmentId, enrollment.id),
    inArray(s.touches.status, [...openStatuses]),
  ];
  if (stepNumbers) {
    if (!stepNumbers.length) return [];
    conditions.push(inArray(s.touches.stepNumber, [...stepNumbers]));
  }
  const expired = await db
    .update(s.touches)
    .set({
      status: "expired",
      approvedHash: null,
      approvedBy: null,
      closedAt: now,
      updatedAt: now,
      version: sql`${s.touches.version} + 1`,
    })
    .where(and(...conditions))
    .returning();
  if (expired.length)
    await db.insert(s.changeEvents).values(
      expired.map((touch) => ({
        organizationId: touch.organizationId,
        productId: touch.productId,
        actorId: principal.userId,
        type: "touch.expired",
        entityId: touch.id,
      })),
    );
  return expired;
}

export async function advance(
  db: Reader,
  principal: Principal,
  organizationId: string,
  productIds: readonly string[],
  now: number,
  enrollmentIds?: readonly string[],
) {
  const result = { created: 0, completed: 0, paused: 0 };
  if (!productIds.length || (enrollmentIds && !enrollmentIds.length))
    return result;
  const running = await db
    .select()
    .from(s.enrollments)
    .where(
      and(
        eq(s.enrollments.organizationId, organizationId),
        inArray(s.enrollments.productId, [...productIds]),
        eq(s.enrollments.status, "running"),
        enrollmentIds
          ? inArray(s.enrollments.id, [...enrollmentIds])
          : undefined,
      ),
    )
    .orderBy(asc(s.enrollments.id));
  if (!running.length) return result;
  const archivedProducts = new Set(
    (
      await db
        .select({ id: s.products.id })
        .from(s.products)
        .where(
          and(
            eq(s.products.organizationId, organizationId),
            inArray(s.products.id, [
              ...new Set(running.map((row) => row.productId)),
            ]),
            isNotNull(s.products.archivedAt),
          ),
        )
    ).map((row) => row.id),
  );
  const [sequences, touches, relationships, rules, zone] = await Promise.all([
    db
      .select()
      .from(s.sequences)
      .where(
        and(
          eq(s.sequences.organizationId, organizationId),
          inArray(s.sequences.id, [
            ...new Set(running.map((row) => row.sequenceId)),
          ]),
          isNull(s.sequences.archivedAt),
        ),
      ),
    db
      .select()
      .from(s.touches)
      .where(
        and(
          eq(s.touches.organizationId, organizationId),
          inArray(
            s.touches.enrollmentId,
            running.map((row) => row.id),
          ),
        ),
      ),
    db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.organizationId, organizationId),
          inArray(
            s.relationships.id,
            running.map((row) => row.relationshipId),
          ),
        ),
      ),
    readContactRules(db, organizationId),
    workspaceZone(db, organizationId),
  ]);
  const people = new Map(
    (
      await db
        .select()
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, organizationId),
            inArray(s.people.id, [
              ...new Set(relationships.map((row) => row.personId)),
            ]),
          ),
        )
    ).map((person) => [person.id, person]),
  );
  const contacts = await lastContacts(db, organizationId, [...people.keys()]);
  const at = new Date(now);
  for (const enrollment of running) {
    const sequence = sequences.find((row) => row.id === enrollment.sequenceId);
    const relationship = relationships.find(
      (row) => row.id === enrollment.relationshipId,
    );
    const person = relationship && people.get(relationship.personId);
    if (
      !sequence ||
      !relationship ||
      !person ||
      person.archivedAt ||
      archivedProducts.has(enrollment.productId)
    )
      continue;
    const decision = planEnrollment({
      now,
      enrollment: {
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.getTime(),
      },
      steps: sequence.steps,
      touches: touches
        .filter((touch) => touch.enrollmentId === enrollment.id)
        .map((touch) => ({
          stepNumber: touch.stepNumber,
          status: touch.status,
          sentAt: touch.sentAt?.getTime() ?? null,
          closedAt: touch.closedAt?.getTime() ?? null,
        })),
      doNotContact: person.doNotContact,
      timeZone: person.timeZone ?? zone,
      lastContactAt: contacts.get(person.id) ?? null,
      rules,
    });
    if (decision.kind === "create") {
      const step = sequence.steps.find(
        (candidate) => candidate.number === decision.step.number,
      );
      const draft = step?.template ?? "";
      const [claimed] = await db
        .update(s.enrollments)
        .set({
          step: decision.step.number,
          version: sql`${s.enrollments.version} + 1`,
        })
        .where(
          and(
            eq(s.enrollments.id, enrollment.id),
            eq(s.enrollments.status, "running"),
          ),
        )
        .returning({ id: s.enrollments.id });
      if (!claimed) continue;
      const [touch] = await db
        .insert(s.touches)
        .values({
          organizationId,
          productId: enrollment.productId,
          relationshipId: relationship.id,
          enrollmentId: enrollment.id,
          stepNumber: decision.step.number,
          followUp: decision.step.followUp,
          channel: decision.step.channel,
          senderId: relationship.ownerId,
          dueAt: new Date(decision.dueAt),
          draft,
          draftHash: draftHash({
            draft,
            ...(await draftSubject(db, person)),
            channel: decision.step.channel,
            productId: enrollment.productId,
          }),
        })
        .onConflictDoNothing()
        .returning();
      if (!touch) continue;
      contacts.set(
        person.id,
        Math.max(contacts.get(person.id) ?? decision.dueAt, decision.dueAt),
      );
      await db.insert(s.changeEvents).values({
        organizationId,
        productId: enrollment.productId,
        actorId: principal.userId,
        type: "touch.planned",
        entityId: touch.id,
      });
      result.created += 1;
    } else if (decision.kind === "complete" || decision.kind === "pause") {
      const [changed] = await db
        .update(s.enrollments)
        .set(
          decision.kind === "complete"
            ? {
                status: "completed",
                version: sql`${s.enrollments.version} + 1`,
              }
            : {
                status: "paused",
                pauseReason: decision.reason,
                version: sql`${s.enrollments.version} + 1`,
              },
        )
        .where(
          and(
            eq(s.enrollments.id, enrollment.id),
            eq(s.enrollments.status, "running"),
          ),
        )
        .returning();
      if (!changed) continue;
      if (decision.kind === "complete")
        await expireOpenTouches(db, principal, changed, at);
      await db.insert(s.changeEvents).values({
        organizationId,
        productId: enrollment.productId,
        actorId: principal.userId,
        type:
          decision.kind === "complete"
            ? "enrollment.completed"
            : "enrollment.paused",
        entityId: enrollment.id,
      });
      if (decision.kind === "complete") result.completed += 1;
      else result.paused += 1;
    }
  }
  return result;
}

async function gateContext(
  db: Reader,
  organizationId: string,
  personIds: readonly string[],
  now: number,
) {
  const [rules, zone, contacts] = await Promise.all([
    readContactRules(db, organizationId),
    workspaceZone(db, organizationId),
    lastContacts(db, organizationId, personIds),
  ]);
  const counts = new Map<string, Promise<number>>();
  return async (
    touch: Pick<Touch, "senderId">,
    person: Pick<
      typeof s.people.$inferSelect,
      "id" | "doNotContact" | "timeZone"
    >,
  ) => {
    const count =
      counts.get(touch.senderId) ??
      sentOnDay(db, organizationId, touch.senderId, now, zone);
    counts.set(touch.senderId, count);
    return sendWindow({
      now,
      doNotContact: person.doNotContact,
      timeZone: person.timeZone ?? zone,
      workspaceTimeZone: zone,
      lastContactAt: contacts.get(person.id) ?? null,
      sentTodayBySender: await count,
      rules,
    });
  };
}

function gateData(gate: Awaited<ReturnType<typeof sendGate>>) {
  return {
    sendAfter:
      gate.sendAfter === null ? null : new Date(gate.sendAfter).toISOString(),
    reasons: gate.reasons.map((reason) =>
      "until" in reason
        ? { ...reason, until: new Date(reason.until).toISOString() }
        : reason,
    ),
  };
}

export async function sendGate(db: Reader, touch: Touch, now: number) {
  const [row] = await db
    .select({ person: s.people })
    .from(s.relationships)
    .innerJoin(
      s.people,
      and(
        eq(s.people.id, s.relationships.personId),
        eq(s.people.organizationId, s.relationships.organizationId),
      ),
    )
    .where(
      and(
        eq(s.relationships.id, touch.relationshipId),
        eq(s.relationships.organizationId, touch.organizationId),
      ),
    );
  if (!row) throw new DomainError("NOT_FOUND", 404);
  const gate = await gateContext(
    db,
    touch.organizationId,
    [row.person.id],
    now,
  );
  return gate(touch, row.person);
}

export async function outboundGate(
  db: Reader,
  organizationId: string,
  senderId: string,
  person: Pick<
    typeof s.people.$inferSelect,
    "id" | "doNotContact" | "timeZone"
  >,
  now: number,
) {
  return (await gateContext(db, organizationId, [person.id], now))(
    { senderId },
    person,
  );
}

export async function pauseForReply(
  db: Reader,
  input: {
    organizationId: string;
    personIds: readonly string[];
    occurredAt: Date;
    actorId: string;
    pause: boolean;
  },
) {
  const personIds = [...new Set(input.personIds)];
  if (!personIds.length) return;
  const relationships = await db
    .update(s.relationships)
    .set({
      lastInboundAt: sql`greatest(coalesce(${s.relationships.lastInboundAt}, ${input.occurredAt.toISOString()}::timestamptz), ${input.occurredAt.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(s.relationships.organizationId, input.organizationId),
        inArray(s.relationships.personId, personIds),
      ),
    )
    .returning({ id: s.relationships.id });
  if (!input.pause || !relationships.length) return;
  const relationshipIds = relationships.map((row) => row.id);
  const paused = await db
    .update(s.enrollments)
    .set({
      status: "paused",
      pauseReason: "reply",
      version: sql`${s.enrollments.version} + 1`,
    })
    .where(
      and(
        eq(s.enrollments.organizationId, input.organizationId),
        inArray(s.enrollments.relationshipId, relationshipIds),
        eq(s.enrollments.status, "running"),
      ),
    )
    .returning();
  const reverted = await db
    .update(s.touches)
    .set({
      status: "drafted",
      approvedHash: null,
      approvedBy: null,
      updatedAt: input.occurredAt,
      version: sql`${s.touches.version} + 1`,
    })
    .where(
      and(
        eq(s.touches.organizationId, input.organizationId),
        inArray(s.touches.relationshipId, relationshipIds),
        eq(s.touches.status, "approved"),
      ),
    )
    .returning();
  const events = [
    ...paused.map((row) => ({
      organizationId: row.organizationId,
      productId: row.productId,
      actorId: input.actorId,
      type: "enrollment.paused",
      entityId: row.id,
    })),
    ...reverted.map((row) => ({
      organizationId: row.organizationId,
      productId: row.productId,
      actorId: input.actorId,
      type: "touch.approval_invalidated",
      entityId: row.id,
    })),
  ];
  if (events.length) await db.insert(s.changeEvents).values(events);
}

export async function peopleByEmail(
  db: Reader,
  organizationId: string,
  email: string,
) {
  const lowered = email.trim().toLowerCase();
  if (!lowered) return [];
  const rows = await db
    .select({ id: s.people.id })
    .from(s.people)
    .where(
      and(
        eq(s.people.organizationId, organizationId),
        sql`(lower(${s.people.email}) = ${lowered} OR ${s.people.otherEmails} ?| array[${lowered}]::text[])`,
      ),
    );
  return rows.map((row) => row.id);
}

export class OutreachService {
  constructor(
    private db: Database,
    private clock: () => number = Date.now,
  ) {}

  async advanceEnrollments(
    principal: Principal,
    input: { organizationId: string },
  ) {
    requireWriteActor(principal);
    const permission = await authorize(
      this.db,
      principal,
      input.organizationId,
      undefined,
      true,
    );
    return this.db.transaction((tx) =>
      advance(
        tx,
        principal,
        input.organizationId,
        permission.products.map((product) => product.id),
        this.clock(),
      ),
    );
  }

  async enroll(principal: Principal, input: z.infer<typeof enrollSchema>) {
    return this.db.transaction(async (tx) => {
      const [sequence] = await tx
        .select()
        .from(s.sequences)
        .where(
          and(
            eq(s.sequences.id, input.sequenceId),
            eq(s.sequences.organizationId, input.organizationId),
          ),
        )
        .for("share");
      if (!sequence) throw new DomainError("NOT_FOUND", 404);
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        sequence.productId,
        true,
      );
      if (input.productId && input.productId !== sequence.productId)
        throw new DomainError("FORBIDDEN", 403);
      await assertProductActive(tx, input.organizationId, sequence.productId);
      if (sequence.archivedAt) throw new DomainError("SEQUENCE_ARCHIVED", 409);
      const readable = new Set(
        permission.products.map((product) => product.id),
      );
      const requested = [...new Set(input.relationshipIds)];
      const relationships = await tx
        .select()
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, input.organizationId),
            inArray(s.relationships.id, requested),
          ),
        );
      const personIds = [
        ...new Set(
          relationships
            .filter((row) => row.productId === sequence.productId)
            .map((row) => row.personId),
        ),
      ].sort();
      const people = new Map(
        (personIds.length
          ? await tx
              .select()
              .from(s.people)
              .where(
                and(
                  eq(s.people.organizationId, input.organizationId),
                  inArray(s.people.id, personIds),
                ),
              )
              .orderBy(asc(s.people.id))
              .for("update")
          : []
        ).map((person) => [person.id, person]),
      );
      const active = await tx
        .select({
          relationshipId: s.enrollments.relationshipId,
          sequenceId: s.enrollments.sequenceId,
        })
        .from(s.enrollments)
        .where(
          and(
            eq(s.enrollments.organizationId, input.organizationId),
            inArray(s.enrollments.relationshipId, requested),
            inArray(s.enrollments.status, ["running", "paused"]),
          ),
        );
      const skipped: { relationshipId: string; reason: string }[] = [];
      const eligible: (typeof s.relationships.$inferSelect)[] = [];
      for (const relationshipId of requested) {
        const relationship = relationships.find(
          (row) => row.id === relationshipId,
        );
        const person = relationship && people.get(relationship.personId);
        const enrolled = active.filter(
          (row) => row.relationshipId === relationshipId,
        );
        const reason =
          !relationship || !readable.has(relationship.productId)
            ? "not_found"
            : relationship.productId !== sequence.productId
              ? "other_brand"
              : !person || person.archivedAt
                ? "archived"
                : person.doNotContact
                  ? "do_not_contact"
                  : enrolled.some((row) => row.sequenceId === sequence.id)
                    ? "already_enrolled"
                    : enrolled.length
                      ? "in_another_sequence"
                      : null;
        if (reason) skipped.push({ relationshipId, reason });
        else if (relationship) eligible.push(relationship);
      }
      if (input.dryRun)
        return {
          dryRun: true,
          enrolled: eligible.map((row) => ({
            relationshipId: row.id,
            enrollmentId: null,
          })),
          skipped,
        };
      await assertActiveRelationships(
        tx,
        input.organizationId,
        eligible.map((row) => row.id),
      );
      const now = new Date(this.clock());
      const created = eligible.length
        ? await tx
            .insert(s.enrollments)
            .values(
              eligible.map((relationship) => ({
                organizationId: input.organizationId,
                productId: sequence.productId,
                relationshipId: relationship.id,
                sequenceId: sequence.id,
                status: "running" as const,
                enrolledAt: now,
              })),
            )
            .onConflictDoNothing()
            .returning()
        : [];
      if (created.length)
        await tx.insert(s.changeEvents).values(
          created.map((enrollment) => ({
            organizationId: input.organizationId,
            productId: sequence.productId,
            actorId: principal.userId,
            type: "enrollment.created",
            entityId: enrollment.id,
          })),
        );
      await advance(
        tx,
        principal,
        input.organizationId,
        [sequence.productId],
        now.getTime(),
        created.map((row) => row.id),
      );
      return {
        dryRun: false,
        enrolled: created.map((row) => ({
          relationshipId: row.relationshipId,
          enrollmentId: row.id,
        })),
        skipped,
      };
    });
  }

  async dueTouches(principal: Principal, scope: z.infer<typeof scopeSchema>) {
    const permission = await authorize(
      this.db,
      principal,
      scope.organizationId,
      scope.productId,
    );
    const productIds = permission.products
      .map((product) => product.id)
      .filter((id) => !scope.productId || id === scope.productId);
    const now = this.clock();
    const zone = await workspaceZone(this.db, scope.organizationId);
    const [, endOfToday] = zonedDayBounds(now, zone);
    const rows = productIds.length
      ? await this.db
          .select({
            touch: s.touches,
            person: {
              id: s.people.id,
              name: s.people.name,
              email: s.people.email,
              doNotContact: s.people.doNotContact,
              timeZone: s.people.timeZone,
            },
            stageId: s.relationships.stageId,
          })
          .from(s.touches)
          .innerJoin(
            s.enrollments,
            and(
              eq(s.enrollments.id, s.touches.enrollmentId),
              eq(s.enrollments.organizationId, s.touches.organizationId),
            ),
          )
          .innerJoin(
            s.relationships,
            and(
              eq(s.relationships.id, s.touches.relationshipId),
              eq(s.relationships.organizationId, s.touches.organizationId),
            ),
          )
          .innerJoin(
            s.people,
            and(
              eq(s.people.id, s.relationships.personId),
              eq(s.people.organizationId, s.relationships.organizationId),
            ),
          )
          .where(
            and(
              eq(s.touches.organizationId, scope.organizationId),
              inArray(s.touches.productId, productIds),
              inArray(s.touches.status, [...openStatuses]),
              lt(s.touches.dueAt, new Date(endOfToday)),
              eq(s.enrollments.status, "running"),
              isNull(s.people.archivedAt),
            ),
          )
          .orderBy(asc(s.touches.dueAt), asc(s.touches.id))
      : [];
    const gate = await gateContext(
      this.db,
      scope.organizationId,
      [...new Set(rows.map((row) => row.person.id))],
      now,
    );
    const listed = await Promise.all(
      rows.map(async (row) => {
        const window = await gate(row.touch, row.person);
        return {
          ...row.touch,
          person: row.person,
          stageId: row.stageId,
          allowed: window.allowed,
          ...gateData(window),
        };
      }),
    );
    return {
      groups: [0, 1, 2, 3].map((followUp) => ({
        followUp,
        touches: listed.filter((touch) => touch.followUp === followUp),
      })),
      asOf: new Date(now).toISOString(),
    };
  }

  async queue(principal: Principal, scope: z.infer<typeof scopeSchema>) {
    const permission = await authorize(
      this.db,
      principal,
      scope.organizationId,
      scope.productId,
    );
    const productIds = permission.products
      .map((product) => product.id)
      .filter((id) => !scope.productId || id === scope.productId);
    const now = this.clock();
    const asOf = new Date(now).toISOString();
    if (!productIds.length)
      return { drafts: [], approved: [], sent: [], paused: [], asOf };
    const person = {
      id: s.people.id,
      name: s.people.name,
      email: s.people.email,
      doNotContact: s.people.doNotContact,
      timeZone: s.people.timeZone,
      archivedAt: s.people.archivedAt,
    };
    const rows = await this.db
      .select({
        touch: s.touches,
        person,
        stageId: s.relationships.stageId,
        sequenceName: s.sequences.name,
        sentByName: s.user.name,
      })
      .from(s.touches)
      .innerJoin(
        s.enrollments,
        and(
          eq(s.enrollments.id, s.touches.enrollmentId),
          eq(s.enrollments.organizationId, s.touches.organizationId),
        ),
      )
      .innerJoin(
        s.sequences,
        and(
          eq(s.sequences.id, s.enrollments.sequenceId),
          eq(s.sequences.organizationId, s.enrollments.organizationId),
        ),
      )
      .innerJoin(
        s.relationships,
        and(
          eq(s.relationships.id, s.touches.relationshipId),
          eq(s.relationships.organizationId, s.touches.organizationId),
        ),
      )
      .innerJoin(
        s.people,
        and(
          eq(s.people.id, s.relationships.personId),
          eq(s.people.organizationId, s.relationships.organizationId),
        ),
      )
      .leftJoin(s.user, eq(s.user.id, s.touches.sentBy))
      .where(
        and(
          eq(s.touches.organizationId, scope.organizationId),
          inArray(s.touches.productId, productIds),
          or(
            and(
              inArray(s.touches.status, [...openStatuses]),
              eq(s.enrollments.status, "running"),
              isNull(s.people.archivedAt),
            ),
            and(
              eq(s.touches.status, "sent"),
              gte(s.touches.sentAt, new Date(now - sentWindowDays * day)),
            ),
          ),
        ),
      )
      .orderBy(asc(s.touches.dueAt), asc(s.touches.id));
    const gate = await gateContext(
      this.db,
      scope.organizationId,
      [
        ...new Set(
          rows
            .filter((row) => row.touch.status === "approved")
            .map((row) => row.person.id),
        ),
      ],
      now,
    );
    const listed = await Promise.all(
      rows.map(async ({ touch, person: who, ...row }) => {
        const base = {
          ...touch,
          ...row,
          person: { ...who, archived: !!who.archivedAt },
        };
        if (touch.status !== "approved")
          return { ...base, allowed: true, sendAfter: null, reasons: [] };
        const window = await gate(touch, who);
        return { ...base, allowed: window.allowed, ...gateData(window) };
      }),
    );
    const paused = await this.db
      .select({
        enrollment: s.enrollments,
        person,
        sequenceName: s.sequences.name,
        stageId: s.relationships.stageId,
        lastInboundAt: s.relationships.lastInboundAt,
      })
      .from(s.enrollments)
      .innerJoin(
        s.sequences,
        and(
          eq(s.sequences.id, s.enrollments.sequenceId),
          eq(s.sequences.organizationId, s.enrollments.organizationId),
        ),
      )
      .innerJoin(
        s.relationships,
        and(
          eq(s.relationships.id, s.enrollments.relationshipId),
          eq(s.relationships.organizationId, s.enrollments.organizationId),
        ),
      )
      .innerJoin(
        s.people,
        and(
          eq(s.people.id, s.relationships.personId),
          eq(s.people.organizationId, s.relationships.organizationId),
        ),
      )
      .where(
        and(
          eq(s.enrollments.organizationId, scope.organizationId),
          inArray(s.enrollments.productId, productIds),
          eq(s.enrollments.status, "paused"),
        ),
      )
      .orderBy(desc(s.relationships.lastInboundAt), asc(s.enrollments.id));
    return {
      drafts: listed.filter(
        (touch) => touch.status === "planned" || touch.status === "drafted",
      ),
      approved: listed.filter((touch) => touch.status === "approved"),
      sent: listed
        .filter((touch) => touch.status === "sent")
        .sort(
          (a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0),
        ),
      paused: paused.map(({ enrollment, person: who, ...row }) => ({
        ...enrollment,
        ...row,
        person: { ...who, archived: !!who.archivedAt },
      })),
      asOf,
    };
  }

  async touch(principal: Principal, input: z.infer<typeof touchQuerySchema>) {
    const [touch] = await this.db
      .select()
      .from(s.touches)
      .where(
        and(
          eq(s.touches.id, input.touchId),
          eq(s.touches.organizationId, input.organizationId),
        ),
      );
    if (!touch) throw new DomainError("NOT_FOUND", 404);
    await authorize(this.db, principal, input.organizationId, touch.productId);
    if (input.productId && input.productId !== touch.productId)
      throw new DomainError("FORBIDDEN", 403);
    const [relationship] = await this.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.id, touch.relationshipId));
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    const [[person], [enrollment], history, rules, zone] = await Promise.all([
      this.db
        .select()
        .from(s.people)
        .where(eq(s.people.id, relationship.personId)),
      this.db
        .select()
        .from(s.enrollments)
        .where(eq(s.enrollments.id, touch.enrollmentId)),
      this.db
        .select()
        .from(s.touches)
        .where(
          and(
            eq(s.touches.organizationId, input.organizationId),
            eq(s.touches.relationshipId, touch.relationshipId),
          ),
        )
        .orderBy(asc(s.touches.dueAt), asc(s.touches.id)),
      readContactRules(this.db, input.organizationId),
      workspaceZone(this.db, input.organizationId),
    ]);
    if (!person || !enrollment) throw new DomainError("NOT_FOUND", 404);
    const [sequence] = await this.db
      .select()
      .from(s.sequences)
      .where(eq(s.sequences.id, enrollment.sequenceId));
    const now = this.clock();
    const gate = await (
      await gateContext(this.db, input.organizationId, [person.id], now)
    )(touch, person);
    return {
      touch,
      person,
      relationship,
      enrollment,
      sequence: sequence ?? null,
      step:
        sequence?.steps.find((step) => step.number === touch.stepNumber) ??
        null,
      history,
      rules,
      timeZone: person.timeZone ?? zone,
      allowed: gate.allowed,
      ...gateData(gate),
      asOf: new Date(now).toISOString(),
    };
  }

  private lockedTouch<T>(
    principal: Principal,
    input: z.infer<typeof touchScope>,
    change: (context: {
      tx: Transaction;
      touch: Touch;
      enrollment: Enrollment;
      relationship: typeof s.relationships.$inferSelect;
      person: typeof s.people.$inferSelect;
    }) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(s.touches)
        .where(
          and(
            eq(s.touches.id, input.touchId),
            eq(s.touches.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.id, found.relationshipId));
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      const [person] = await tx
        .select()
        .from(s.people)
        .where(
          and(
            eq(s.people.id, relationship.personId),
            eq(s.people.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!person) throw new DomainError("NOT_FOUND", 404);
      await assertActiveRelationships(tx, input.organizationId, [
        relationship.id,
      ]);
      const [enrollment] = await tx
        .select()
        .from(s.enrollments)
        .where(eq(s.enrollments.id, found.enrollmentId))
        .for("update");
      const [touch] = await tx
        .select()
        .from(s.touches)
        .where(eq(s.touches.id, found.id))
        .for("update");
      if (!enrollment || !touch) throw new DomainError("NOT_FOUND", 404);
      return change({ tx, touch, enrollment, relationship, person });
    });
  }

  private async event(
    db: Reader,
    principal: Principal,
    touch: Touch,
    type: string,
  ) {
    await db.insert(s.changeEvents).values({
      organizationId: touch.organizationId,
      productId: touch.productId,
      actorId: principal.userId,
      type,
      entityId: touch.id,
    });
  }

  async editDraft(
    principal: Principal,
    input: z.infer<typeof touchDraftSchema>,
  ) {
    return this.lockedTouch(principal, input, async ({ tx, touch, person }) => {
      await assertTouchOpen(tx, touch);
      if (touch.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const hash = draftHash({
        draft: input.draft,
        ...(await draftSubject(tx, person)),
        channel: touch.channel,
        productId: touch.productId,
      });
      const keepsApproval =
        touch.status === "approved" && touch.approvedHash === hash;
      const [updated] = await tx
        .update(s.touches)
        .set({
          draft: input.draft,
          draftHash: hash,
          status: keepsApproval
            ? "approved"
            : input.draft.trim()
              ? "drafted"
              : "planned",
          approvedHash: keepsApproval ? touch.approvedHash : null,
          approvedBy: keepsApproval ? touch.approvedBy : null,
          updatedAt: new Date(this.clock()),
          version: touch.version + 1,
        })
        .where(
          and(eq(s.touches.id, touch.id), eq(s.touches.version, touch.version)),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await this.event(tx, principal, touch, "touch.drafted");
      if (touch.approvedHash && !keepsApproval)
        await this.event(tx, principal, touch, "touch.approval_invalidated");
      return updated;
    });
  }

  async approve(
    principal: Principal,
    input: z.infer<typeof touchApproveSchema>,
  ) {
    requireWriteActor(principal);
    return this.lockedTouch(
      principal,
      input,
      async ({ tx, touch, enrollment, person }) => {
        await assertTouchOpen(tx, touch);
        if (touch.version !== input.version)
          throw new DomainError("CONFLICT", 409);
        if (enrollment.status === "paused")
          throw new DomainError("ENROLLMENT_PAUSED", 409);
        if (enrollment.status !== "running")
          throw new DomainError("ENROLLMENT_CLOSED", 409);
        if (!touch.draft.trim()) throw new DomainError("DRAFT_REQUIRED", 400);
        if (person.doNotContact) throw new DomainError("DO_NOT_CONTACT", 409);
        const now = this.clock();
        const hash = draftHash({
          draft: touch.draft,
          ...(await draftSubject(tx, person)),
          channel: touch.channel,
          productId: touch.productId,
        });
        const [updated] = await tx
          .update(s.touches)
          .set({
            status: "approved",
            draftHash: hash,
            approvedHash: hash,
            approvedBy: principal.userId,
            updatedAt: new Date(now),
            version: touch.version + 1,
          })
          .where(
            and(
              eq(s.touches.id, touch.id),
              eq(s.touches.version, touch.version),
            ),
          )
          .returning();
        if (!updated) throw new DomainError("CONFLICT", 409);
        await this.event(tx, principal, touch, "touch.approved");
        return updated;
      },
    );
  }

  async markSent(principal: Principal, input: z.infer<typeof touchSentSchema>) {
    const now = this.clock();
    const sentAt = input.sentAt ? Date.parse(input.sentAt) : now;
    if (sentAt > now + 300000) throw new DomainError("INVALID_INPUT", 400);
    return this.lockedTouch(
      principal,
      input,
      async ({ tx, touch, enrollment, relationship, person }) => {
        await assertTouchOpen(tx, touch);
        if (input.version !== undefined && touch.version !== input.version)
          throw new DomainError("CONFLICT", 409);
        if (person.doNotContact) throw new DomainError("DO_NOT_CONTACT", 409);
        if (input.externalMessageId) {
          const [reported] = await tx
            .select({ id: s.touches.id, productId: s.touches.productId })
            .from(s.touches)
            .where(
              and(
                eq(s.touches.organizationId, touch.organizationId),
                eq(s.touches.channel, touch.channel),
                eq(s.touches.externalMessageId, input.externalMessageId),
              ),
            );
          if (reported) {
            const permission = await authorize(
              tx,
              principal,
              touch.organizationId,
            );
            throw new DomainError(
              "EXTERNAL_MESSAGE_REPORTED",
              409,
              permission.products.some(
                (product) => product.id === reported.productId,
              )
                ? { touchId: reported.id }
                : undefined,
            );
          }
        }
        await tx
          .select({ userId: s.memberships.userId })
          .from(s.memberships)
          .where(
            and(
              eq(s.memberships.organizationId, touch.organizationId),
              eq(s.memberships.userId, touch.senderId),
            ),
          )
          .for("no key update");
        const [rules, zone, contacts] = await Promise.all([
          readContactRules(tx, touch.organizationId),
          workspaceZone(tx, touch.organizationId),
          lastContacts(tx, touch.organizationId, [person.id]),
        ]);
        const hash = draftHash({
          draft: touch.draft,
          ...(await draftSubject(tx, person)),
          channel: touch.channel,
          productId: touch.productId,
        });
        const warnings = [
          ...contactViolations({
            now: sentAt,
            doNotContact: false,
            timeZone: person.timeZone ?? zone,
            lastContactAt: contacts.get(person.id) ?? null,
            sentTodayBySender: await sentOnDay(
              tx,
              touch.organizationId,
              touch.senderId,
              sentAt,
              zone,
            ),
            rules,
          }).map((violation) => warningFor[violation.code]),
          ...(touch.status === "approved" && touch.approvedHash === hash
            ? []
            : ["unapproved"]),
          ...(enrollment.status === "running" ? [] : ["paused"]),
        ];
        const [updated] = await tx
          .update(s.touches)
          .set({
            status: "sent",
            sentBy: principal.userId,
            sentAt: new Date(sentAt),
            externalMessageId: input.externalMessageId ?? null,
            sentWarnings: warnings,
            closedAt: new Date(sentAt),
            updatedAt: new Date(now),
            version: touch.version + 1,
          })
          .where(
            and(
              eq(s.touches.id, touch.id),
              inArray(s.touches.status, [...openStatuses]),
            ),
          )
          .returning()
          .catch((error: unknown) => {
            throw externalMessageConflict(error)
              ? new DomainError("EXTERNAL_MESSAGE_REPORTED", 409)
              : error;
          });
        if (!updated) {
          const [current] = await tx
            .select()
            .from(s.touches)
            .where(eq(s.touches.id, touch.id));
          throw current?.status === "sent"
            ? await sentReport(tx, current)
            : new DomainError("TOUCH_CLOSED", 409);
        }
        await tx
          .update(s.relationships)
          .set({
            touchCount: sql`${s.relationships.touchCount} + 1`,
            lastOutboundAt: sql`greatest(coalesce(${s.relationships.lastOutboundAt}, ${new Date(sentAt).toISOString()}::timestamptz), ${new Date(sentAt).toISOString()}::timestamptz)`,
            version: sql`${s.relationships.version} + 1`,
          })
          .where(eq(s.relationships.id, relationship.id));
        await this.event(tx, principal, touch, "touch.sent");
        await advance(
          tx,
          principal,
          touch.organizationId,
          [touch.productId],
          now,
          [enrollment.id],
        );
        return { touch: updated, warnings };
      },
    );
  }

  async skip(principal: Principal, input: z.infer<typeof touchSkipSchema>) {
    return this.lockedTouch(
      principal,
      input,
      async ({ tx, touch, enrollment }) => {
        await assertTouchOpen(tx, touch);
        if (touch.version !== input.version)
          throw new DomainError("CONFLICT", 409);
        const now = this.clock();
        const [updated] = await tx
          .update(s.touches)
          .set({
            status: "skipped",
            skipReason: input.reason,
            approvedHash: null,
            approvedBy: null,
            closedAt: new Date(now),
            updatedAt: new Date(now),
            version: touch.version + 1,
          })
          .where(
            and(
              eq(s.touches.id, touch.id),
              eq(s.touches.version, touch.version),
            ),
          )
          .returning();
        if (!updated) throw new DomainError("CONFLICT", 409);
        await this.event(tx, principal, touch, "touch.skipped");
        await advance(
          tx,
          principal,
          touch.organizationId,
          [touch.productId],
          now,
          [enrollment.id],
        );
        return updated;
      },
    );
  }

  async reopen(principal: Principal, input: z.infer<typeof touchReopenSchema>) {
    return this.lockedTouch(
      principal,
      input,
      async ({ tx, touch, enrollment }) => {
        if (touch.status !== "skipped" || touch.version !== input.version)
          throw new DomainError("CONFLICT", 409);
        if (enrollment.status === "stopped")
          throw new DomainError("ENROLLMENT_CLOSED", 409);
        if (enrollment.status === "completed") {
          const [sequence] = await tx
            .select({ archivedAt: s.sequences.archivedAt })
            .from(s.sequences)
            .where(
              and(
                eq(s.sequences.id, enrollment.sequenceId),
                eq(s.sequences.organizationId, touch.organizationId),
              ),
            )
            .for("share");
          if (!sequence) throw new DomainError("NOT_FOUND", 404);
          if (sequence.archivedAt)
            throw new DomainError("SEQUENCE_ARCHIVED", 409);
          await assertProductActive(
            tx,
            touch.organizationId,
            enrollment.productId,
          );
        }
        const later = await tx
          .select()
          .from(s.touches)
          .where(
            and(
              eq(s.touches.organizationId, touch.organizationId),
              eq(s.touches.enrollmentId, touch.enrollmentId),
              gt(s.touches.stepNumber, touch.stepNumber),
            ),
          );
        if (later.some((row) => row.status !== "planned" || row.version !== 1))
          throw new DomainError("CONFLICT", 409);
        if (later.length) {
          await tx.insert(s.changeEvents).values(
            later.map((row) => ({
              organizationId: row.organizationId,
              productId: row.productId,
              actorId: principal.userId,
              type: "touch.withdrawn",
              entityId: row.id,
            })),
          );
          await tx.delete(s.touches).where(
            inArray(
              s.touches.id,
              later.map((row) => row.id),
            ),
          );
        }
        const now = new Date(this.clock());
        const [updated] = await tx
          .update(s.touches)
          .set({
            status: touch.draft.trim() ? "drafted" : "planned",
            skipReason: null,
            closedAt: null,
            updatedAt: now,
            version: touch.version + 1,
          })
          .where(
            and(
              eq(s.touches.id, touch.id),
              eq(s.touches.version, touch.version),
            ),
          )
          .returning();
        if (!updated) throw new DomainError("CONFLICT", 409);
        await tx
          .update(s.enrollments)
          .set({
            step: touch.stepNumber,
            status:
              enrollment.status === "completed" ? "running" : enrollment.status,
            version: enrollment.version + 1,
          })
          .where(eq(s.enrollments.id, enrollment.id));
        await this.event(tx, principal, touch, "touch.reopened");
        return updated;
      },
    );
  }

  async snooze(principal: Principal, input: z.infer<typeof touchSnoozeSchema>) {
    return this.lockedTouch(principal, input, async ({ tx, touch }) => {
      await assertTouchOpen(tx, touch);
      if (touch.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const [updated] = await tx
        .update(s.touches)
        .set({
          dueAt: new Date(input.dueAt),
          updatedAt: new Date(this.clock()),
          version: touch.version + 1,
        })
        .where(
          and(eq(s.touches.id, touch.id), eq(s.touches.version, touch.version)),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await this.event(tx, principal, touch, "touch.snoozed");
      return updated;
    });
  }

  async changeEnrollment(
    principal: Principal,
    input: z.infer<typeof enrollmentChangeSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(s.enrollments)
        .where(
          and(
            eq(s.enrollments.id, input.enrollmentId),
            eq(s.enrollments.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.id, found.relationshipId));
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      const [person] = await tx
        .select()
        .from(s.people)
        .where(eq(s.people.id, relationship.personId))
        .for("update");
      if (!person) throw new DomainError("NOT_FOUND", 404);
      await assertActiveRelationships(tx, input.organizationId, [
        relationship.id,
      ]);
      const [sequence] = await tx
        .select({ archivedAt: s.sequences.archivedAt })
        .from(s.sequences)
        .where(eq(s.sequences.id, found.sequenceId))
        .for("share");
      const [enrollment] = await tx
        .select()
        .from(s.enrollments)
        .where(eq(s.enrollments.id, found.id))
        .for("update");
      if (!enrollment) throw new DomainError("NOT_FOUND", 404);
      if (enrollment.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      if (enrollment.status === "completed" || enrollment.status === "stopped")
        throw new DomainError("ENROLLMENT_CLOSED", 409);
      if (input.command === "pause" && enrollment.status !== "running")
        throw new DomainError("ENROLLMENT_PAUSED", 409);
      if (input.command === "resume") {
        if (enrollment.status !== "paused")
          throw new DomainError("CONFLICT", 409);
        if (person.doNotContact) throw new DomainError("DO_NOT_CONTACT", 409);
        if (sequence?.archivedAt)
          throw new DomainError("SEQUENCE_ARCHIVED", 409);
        await assertProductActive(tx, input.organizationId, found.productId);
      }
      const now = this.clock();
      const [updated] = await tx
        .update(s.enrollments)
        .set({
          status:
            input.command === "pause"
              ? "paused"
              : input.command === "resume"
                ? "running"
                : "stopped",
          pauseReason: input.command === "pause" ? "manual" : null,
          version: enrollment.version + 1,
        })
        .where(
          and(
            eq(s.enrollments.id, enrollment.id),
            eq(s.enrollments.version, enrollment.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      if (input.command === "stop")
        await expireOpenTouches(tx, principal, updated, new Date(now));
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: enrollment.productId,
        actorId: principal.userId,
        type:
          input.command === "pause"
            ? "enrollment.paused"
            : input.command === "resume"
              ? "enrollment.resumed"
              : "enrollment.stopped",
        entityId: enrollment.id,
      });
      if (input.command === "resume")
        await advance(
          tx,
          principal,
          input.organizationId,
          [found.productId],
          now,
          [enrollment.id],
        );
      return updated;
    });
  }

  async changeRelationship(
    principal: Principal,
    input: z.infer<typeof relationshipChangeSchema>,
  ) {
    input = relationshipChangeSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.id, input.relationshipId),
            eq(s.relationships.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      await assertActiveRelationships(tx, input.organizationId, [found.id]);
      if (input.stageId)
        await shareLockStage(tx, input.organizationId, input.stageId);
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.id, found.id))
        .for("update");
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      if (relationship.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const moved =
        input.stageId !== undefined && input.stageId !== relationship.stageId;
      if (moved) {
        const [stage] = await tx
          .select()
          .from(s.stages)
          .where(
            and(
              eq(s.stages.id, input.stageId ?? ""),
              eq(s.stages.organizationId, input.organizationId),
              eq(s.stages.productId, relationship.productId),
              eq(s.stages.pipeline, "outreach"),
              isNull(s.stages.archivedAt),
            ),
          )
          .for("share");
        if (!stage) throw new DomainError("NOT_FOUND", 404);
      }
      const ownerChanged =
        input.ownerId !== undefined && input.ownerId !== relationship.ownerId;
      if (input.ownerId !== undefined && ownerChanged)
        await assertProductAccess(tx, input.organizationId, input.ownerId, [
          relationship.productId,
        ]);
      const [updated] = await tx
        .update(s.relationships)
        .set({
          ...(input.context !== undefined
            ? {
                context: input.context,
                // Preserve the original imported document when replacing it with readable notes.
                ...(relationship.contextSource === null &&
                relationship.context !== input.context &&
                relationship.context.trim()
                  ? { contextSource: relationship.context }
                  : {}),
              }
            : {}),
          ...(input.contextDetails !== undefined
            ? {
                contextDetails: relationshipDetailsSchema.parse({
                  ...emptyRelationshipDetails(),
                  ...relationship.contextDetails,
                  ...input.contextDetails,
                }),
              }
            : {}),
          ...(moved ? { stageId: input.stageId } : {}),
          ...(ownerChanged ? { ownerId: input.ownerId } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
          ...(input.nextStepDueAt !== undefined
            ? {
                nextStepDueAt: input.nextStepDueAt
                  ? new Date(input.nextStepDueAt)
                  : null,
              }
            : {}),
          version: relationship.version + 1,
        })
        .where(
          and(
            eq(s.relationships.id, relationship.id),
            eq(s.relationships.version, relationship.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      const edited =
        input.context !== undefined ||
        input.contextDetails !== undefined ||
        input.priority !== undefined ||
        input.nextStep !== undefined ||
        input.nextStepDueAt !== undefined;
      const types = [
        moved
          ? "relationship.stage_moved"
          : edited || !ownerChanged
            ? "relationship.updated"
            : "",
        ownerChanged ? "relationship.owner_changed" : "",
      ].filter(Boolean);
      await tx.insert(s.changeEvents).values(
        types.map((type) => ({
          organizationId: input.organizationId,
          productId: relationship.productId,
          actorId: principal.userId,
          type,
          entityId: relationship.id,
        })),
      );
      if (ownerChanged)
        await reassignTouches(
          tx,
          principal.userId,
          input.organizationId,
          updated.ownerId,
          { relationshipId: relationship.id },
        );
      return updated;
    });
  }

  async createSequence(
    principal: Principal,
    input: z.infer<typeof sequenceCreateSchema>,
  ) {
    const values = sequenceCreateSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        values.organizationId,
        values.productId,
        true,
      );
      await assertProductActive(tx, values.organizationId, values.productId);
      const [sequence] = await tx
        .insert(s.sequences)
        .values({
          organizationId: values.organizationId,
          productId: values.productId,
          name: values.name,
          steps: [...values.steps].sort((a, b) => a.number - b.number),
        })
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: values.organizationId,
        productId: values.productId,
        actorId: principal.userId,
        type: "sequence.created",
        entityId: sequence.id,
      });
      return sequence;
    });
  }
  private async lockSequence(
    tx: Transaction,
    principal: Principal,
    input: z.infer<typeof sequenceArchiveSchema>,
  ) {
    const [found] = await tx
      .select()
      .from(s.sequences)
      .where(
        and(
          eq(s.sequences.id, input.sequenceId),
          eq(s.sequences.organizationId, input.organizationId),
        ),
      );
    if (!found) throw new DomainError("NOT_FOUND", 404);
    await authorize(tx, principal, input.organizationId, found.productId, true);
    if (input.productId && input.productId !== found.productId)
      throw new DomainError("FORBIDDEN", 403);
    const [sequence] = await tx
      .select()
      .from(s.sequences)
      .where(eq(s.sequences.id, found.id))
      .for("update");
    if (!sequence) throw new DomainError("NOT_FOUND", 404);
    if (sequence.version !== input.version)
      throw new DomainError("CONFLICT", 409);
    return sequence;
  }
  async archiveSequence(
    principal: Principal,
    input: z.infer<typeof sequenceArchiveSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const sequence = await this.lockSequence(tx, principal, input);
      if (sequence.archivedAt) throw new DomainError("SEQUENCE_ARCHIVED", 409);
      const [archived] = await tx
        .update(s.sequences)
        .set({
          archivedAt: new Date(this.clock()),
          version: sequence.version + 1,
        })
        .where(eq(s.sequences.id, sequence.id))
        .returning();
      if (!archived) throw new DomainError("CONFLICT", 409);
      const running = await tx
        .select()
        .from(s.enrollments)
        .where(
          and(
            eq(s.enrollments.organizationId, input.organizationId),
            eq(s.enrollments.sequenceId, sequence.id),
            eq(s.enrollments.status, "running"),
          ),
        )
        .orderBy(asc(s.enrollments.id))
        .for("update");
      for (const enrollment of running)
        await tx
          .update(s.enrollments)
          .set({
            status: "paused",
            pauseReason: "manual",
            version: enrollment.version + 1,
          })
          .where(eq(s.enrollments.id, enrollment.id));
      await tx.insert(s.changeEvents).values([
        {
          organizationId: input.organizationId,
          productId: sequence.productId,
          actorId: principal.userId,
          type: "sequence.archived",
          entityId: sequence.id,
        },
        ...running.map((enrollment) => ({
          organizationId: input.organizationId,
          productId: sequence.productId,
          actorId: principal.userId,
          type: "enrollment.paused",
          entityId: enrollment.id,
        })),
      ]);
      return { ...archived, pausedEnrollments: running.length };
    });
  }
  async restoreSequence(
    principal: Principal,
    input: z.infer<typeof sequenceRestoreSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const sequence = await this.lockSequence(tx, principal, input);
      if (!sequence.archivedAt) throw new DomainError("SEQUENCE_ACTIVE", 409);
      const [restored] = await tx
        .update(s.sequences)
        .set({ archivedAt: null, version: sequence.version + 1 })
        .where(eq(s.sequences.id, sequence.id))
        .returning();
      if (!restored) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: sequence.productId,
        actorId: principal.userId,
        type: "sequence.restored",
        entityId: sequence.id,
      });
      return restored;
    });
  }
  async updateSequence(
    principal: Principal,
    input: z.infer<typeof sequenceUpdateSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(s.sequences)
        .where(
          and(
            eq(s.sequences.id, input.sequenceId),
            eq(s.sequences.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      const [sequence] = await tx
        .select()
        .from(s.sequences)
        .where(eq(s.sequences.id, found.id))
        .for("update");
      if (!sequence) throw new DomainError("NOT_FOUND", 404);
      if (sequence.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const steps: Step[] = [...input.steps].sort(
        (a, b) => a.number - b.number,
      );
      const [updated] = await tx
        .update(s.sequences)
        .set({
          name: input.name ?? sequence.name,
          steps,
          version: sequence.version + 1,
        })
        .where(
          and(
            eq(s.sequences.id, sequence.id),
            eq(s.sequences.version, sequence.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: sequence.productId,
        actorId: principal.userId,
        type: "sequence.updated",
        entityId: sequence.id,
      });
      const enrollments = await tx
        .select()
        .from(s.enrollments)
        .where(
          and(
            eq(s.enrollments.organizationId, input.organizationId),
            eq(s.enrollments.sequenceId, sequence.id),
            inArray(s.enrollments.status, ["running", "paused"]),
          ),
        )
        .orderBy(asc(s.enrollments.id))
        .for("update");
      if (!enrollments.length) return { sequence: updated, changedTouches: 0 };
      const now = new Date(this.clock());
      const planned = await tx
        .select({ touch: s.touches, person: s.people })
        .from(s.touches)
        .innerJoin(
          s.relationships,
          eq(s.relationships.id, s.touches.relationshipId),
        )
        .innerJoin(s.people, eq(s.people.id, s.relationships.personId))
        .where(
          and(
            eq(s.touches.organizationId, input.organizationId),
            inArray(
              s.touches.enrollmentId,
              enrollments.map((row) => row.id),
            ),
            eq(s.touches.status, "planned"),
          ),
        );
      let changedTouches = 0;
      for (const { touch, person } of planned) {
        const step = steps.find(
          (candidate) => candidate.number === touch.stepNumber,
        );
        if (
          !step ||
          (step.channel === touch.channel &&
            step.followUp === touch.followUp &&
            step.template === touch.draft)
        )
          continue;
        const [rewritten] = await tx
          .update(s.touches)
          .set({
            channel: step.channel,
            followUp: step.followUp,
            draft: step.template,
            draftHash: draftHash({
              draft: step.template,
              ...(await draftSubject(tx, person)),
              channel: step.channel,
              productId: touch.productId,
            }),
            updatedAt: now,
            version: touch.version + 1,
          })
          .where(
            and(
              eq(s.touches.id, touch.id),
              eq(s.touches.status, "planned"),
              eq(s.touches.version, touch.version),
            ),
          )
          .returning({ id: s.touches.id });
        if (rewritten) changedTouches += 1;
      }
      const numbers = new Set(steps.map((step) => step.number));
      for (const enrollment of enrollments) {
        const removed = planned
          .filter(
            ({ touch }) =>
              touch.enrollmentId === enrollment.id &&
              !numbers.has(touch.stepNumber),
          )
          .map(({ touch }) => touch.stepNumber);
        changedTouches += (
          await expireOpenTouches(tx, principal, enrollment, now, removed)
        ).length;
      }
      await advance(
        tx,
        principal,
        input.organizationId,
        [found.productId],
        now.getTime(),
        enrollments.map((row) => row.id),
      );
      return { sequence: updated, changedTouches };
    });
  }

  async contactRules(principal: Principal, organizationId: string) {
    await authorize(this.db, principal, organizationId);
    return readContactRules(this.db, organizationId);
  }

  async updateContactRules(
    principal: Principal,
    input: z.infer<typeof contactRulesSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      const { membership } = await authorize(
        tx,
        principal,
        input.organizationId,
        undefined,
        true,
      );
      if (
        membership.role !== "admin" ||
        (principal.source === "mcp" && principal.productIds !== undefined)
      )
        throw new DomainError("FORBIDDEN", 403);
      if (
        principal.source === "mcp" &&
        loosensContactRules(
          await readContactRules(tx, input.organizationId),
          input,
        )
      )
        throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
      const values = {
        cooldownDays: input.cooldownDays,
        dailyCapPerSender: input.dailyCapPerSender,
        quietHoursStart: input.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd,
      };
      const [saved] =
        input.version === 0
          ? await tx
              .insert(s.contactRules)
              .values({ organizationId: input.organizationId, ...values })
              .onConflictDoNothing()
              .returning()
          : await tx
              .update(s.contactRules)
              .set({ ...values, version: input.version + 1 })
              .where(
                and(
                  eq(s.contactRules.organizationId, input.organizationId),
                  eq(s.contactRules.version, input.version),
                ),
              )
              .returning();
      if (!saved) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "contact_rules.updated",
        entityId: input.organizationId,
      });
      return saved;
    });
  }

  async setContactPreferences(
    principal: Principal,
    input: z.infer<typeof contactPreferencesSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const [person] = await tx
        .select()
        .from(s.people)
        .where(
          and(
            eq(s.people.id, input.personId),
            eq(s.people.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (
        !person ||
        !(await personVisible(
          tx,
          permission.products.map((product) => product.id),
          input.organizationId,
          person.id,
        ))
      )
        throw new DomainError("NOT_FOUND", 404);
      if (person.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      if (person.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
      if (
        principal.source === "mcp" &&
        person.doNotContact &&
        !input.doNotContact
      )
        throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
      const zone =
        input.timeZone === undefined ? person.timeZone : input.timeZone;
      if (
        principal.source === "mcp" &&
        zone !== person.timeZone &&
        (await unblocksNow(tx, input.organizationId, this.clock(), {
          before: person.timeZone,
          after: zone,
        }))
      )
        throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
      const [updated] = await tx
        .update(s.people)
        .set({
          doNotContact: input.doNotContact,
          timeZone: zone,
          version: person.version + 1,
        })
        .where(
          and(eq(s.people.id, person.id), eq(s.people.version, person.version)),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "person.contact_preferences",
        entityId: person.id,
      });
      if (input.doNotContact && !person.doNotContact) {
        await clearApprovals(tx, principal, input.organizationId, person.id);
        const relationships = await tx
          .select({ id: s.relationships.id })
          .from(s.relationships)
          .where(
            and(
              eq(s.relationships.organizationId, input.organizationId),
              eq(s.relationships.personId, person.id),
            ),
          );
        const paused = relationships.length
          ? await tx
              .update(s.enrollments)
              .set({
                status: "paused",
                pauseReason: "do_not_contact",
                version: sql`${s.enrollments.version} + 1`,
              })
              .where(
                and(
                  eq(s.enrollments.organizationId, input.organizationId),
                  inArray(
                    s.enrollments.relationshipId,
                    relationships.map((row) => row.id),
                  ),
                  eq(s.enrollments.status, "running"),
                ),
              )
              .returning()
          : [];
        if (paused.length)
          await tx.insert(s.changeEvents).values(
            paused.map((enrollment) => ({
              organizationId: enrollment.organizationId,
              productId: enrollment.productId,
              actorId: principal.userId,
              type: "enrollment.paused",
              entityId: enrollment.id,
            })),
          );
      }
      return updated;
    });
  }
}

export type DueTouches = Awaited<ReturnType<OutreachService["dueTouches"]>>;
export type TouchContext = Awaited<ReturnType<OutreachService["touch"]>>;
export type OutreachQueue = Awaited<ReturnType<OutreachService["queue"]>>;
