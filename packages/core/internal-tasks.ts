import { and, asc, eq, exists, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { utcCalendarInstant, wallClock, zonedInstant } from "./calendar";
import { lockContactDirectory } from "./contact-history";
import { preciseInstantSchema } from "./datetime";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { assertActiveRelationships } from "./visibility";
import { ianaTimeZoneSchema } from "./workspace";

const scope = z.object({
  organizationId: z.uuid(),
  productId: z.uuid().optional(),
});
export const internalTaskRecurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(365),
});
const taskFields = {
  relationshipId: z.uuid().nullable(),
  ownerId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000),
  dueAt: preciseInstantSchema,
  timeZone: ianaTimeZoneSchema,
  recurrence: internalTaskRecurrenceSchema.nullable(),
};
export const listInternalTasksSchema = scope;
export const createInternalTaskSchema = scope.extend({
  ...taskFields,
  productId: z.uuid(),
  relationshipId: taskFields.relationshipId.default(null),
  description: taskFields.description.default(""),
  recurrence: taskFields.recurrence.default(null),
});
export const changeInternalTaskSchema = scope
  .extend({
    taskId: z.uuid(),
    version: z.number().int().positive(),
    command: z.enum(["save", "complete", "reopen"]),
    ...(Object.fromEntries(
      Object.entries(taskFields).map(([key, schema]) => [
        key,
        schema.optional(),
      ]),
    ) as {
      [K in keyof typeof taskFields]: z.ZodOptional<(typeof taskFields)[K]>;
    }),
  })
  .refine((input) => {
    const changed = Object.keys(taskFields).some(
      (key) => input[key as keyof typeof taskFields] !== undefined,
    );
    return input.command === "save" ? changed : !changed;
  });

export interface TaskRecurrence {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  anchorDay: number;
}

// Calendar recurrence preserves the wall clock across DST and skips missed occurrences.
// Monthly tasks retain their original day, clamping only for shorter months.
export function nextInternalTaskDue(
  dueAt: Date,
  timeZone: string,
  recurrence: TaskRecurrence,
  completedAt: number,
) {
  const start = wallClock(dueAt.getTime(), timeZone);
  const now = wallClock(Math.max(completedAt, dueAt.getTime()), timeZone);
  const startDay = utcCalendarInstant(start.year, start.month, start.day);
  const nowDay = utcCalendarInstant(now.year, now.month, now.day);
  const months = (now.year - start.year) * 12 + now.month - start.month;
  const span =
    recurrence.interval * (recurrence.frequency === "weekly" ? 7 : 1);
  let occurrence =
    recurrence.frequency === "monthly"
      ? Math.max(1, Math.floor(months / span))
      : Math.max(1, Math.floor((nowDay - startDay) / 86400000 / span));
  const precision = dueAt.getUTCMilliseconds();
  for (;;) {
    const target =
      recurrence.frequency === "monthly"
        ? new Date(
            utcCalendarInstant(start.year, start.month + occurrence * span, 1),
          )
        : new Date(startDay + occurrence * span * 86400000);
    const date =
      recurrence.frequency === "monthly"
        ? Math.min(
            recurrence.anchorDay,
            new Date(
              utcCalendarInstant(
                target.getUTCFullYear(),
                target.getUTCMonth() + 2,
                0,
              ),
            ).getUTCDate(),
          )
        : target.getUTCDate();
    const next =
      zonedInstant(
        target.getUTCFullYear(),
        target.getUTCMonth() + 1,
        date,
        start.hour,
        timeZone,
        start.minute,
        start.second,
      ) + precision;
    const nextDate = new Date(next);
    const utcYear = nextDate.getUTCFullYear();
    if (!Number.isFinite(next) || utcYear < 1 || utcYear > 9999)
      throw new DomainError("INVALID_INPUT", 400);
    const actual = wallClock(next, timeZone);
    // A nonexistent local time is skipped, retaining the recurring wall clock.
    // Normalizing a DST gap would shift every subsequent daily occurrence.
    if (
      next > Math.max(completedAt, dueAt.getTime()) &&
      actual.year === target.getUTCFullYear() &&
      actual.month === target.getUTCMonth() + 1 &&
      actual.day === date &&
      actual.hour === start.hour &&
      actual.minute === start.minute &&
      actual.second === start.second
    )
      return nextDate;
    occurrence += 1;
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function validateOwner(
  tx: Transaction,
  organizationId: string,
  productId: string,
  ownerId: string,
) {
  try {
    await authorize(
      tx,
      { userId: ownerId, source: "session" },
      organizationId,
      productId,
    );
  } catch (error) {
    if (error instanceof DomainError)
      throw new DomainError("OWNER_NOT_ALLOWED", 403);
    throw error;
  }
}
async function validateRelationship(
  tx: Transaction,
  organizationId: string,
  productId: string,
  relationshipId: string | null,
) {
  if (!relationshipId) return;
  const [relationship] = await tx
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        eq(s.relationships.productId, productId),
        eq(s.relationships.id, relationshipId),
      ),
    );
  if (!relationship) throw new DomainError("NOT_FOUND", 404);
  await assertActiveRelationships(tx, organizationId, [relationshipId]);
}

export class InternalTaskService {
  constructor(
    private db: Database,
    private clock: () => number = Date.now,
  ) {}

  async list(
    principal: Principal,
    input: z.infer<typeof listInternalTasksSchema>,
  ) {
    const permission = await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
    );
    const productIds = permission.products
      .filter((product) => !input.productId || product.id === input.productId)
      .map((product) => product.id);
    return this.db
      .select()
      .from(s.internalTasks)
      .where(
        and(
          eq(s.internalTasks.organizationId, input.organizationId),
          inArray(s.internalTasks.productId, productIds),
          or(
            isNull(s.internalTasks.relationshipId),
            exists(
              this.db
                .select({ id: s.relationships.id })
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
                    eq(s.relationships.id, s.internalTasks.relationshipId),
                    eq(s.relationships.organizationId, input.organizationId),
                    eq(s.relationships.productId, s.internalTasks.productId),
                    isNull(s.people.archivedAt),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(asc(s.internalTasks.dueAt), asc(s.internalTasks.id));
  }

  async create(
    principal: Principal,
    input: z.infer<typeof createInternalTaskSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      // Membership and product-grant changes lock the organization first. Keep
      // access stable through later product, task and contact lock waits.
      await lockContactDirectory(tx, input.organizationId);
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, input.productId);
      await validateOwner(
        tx,
        input.organizationId,
        input.productId,
        input.ownerId,
      );
      await validateRelationship(
        tx,
        input.organizationId,
        input.productId,
        input.relationshipId,
      );
      const [task] = await tx
        .insert(s.internalTasks)
        .values({
          ...input,
          dueAt: new Date(input.dueAt),
          recurrence: input.recurrence
            ? {
                ...input.recurrence,
                anchorDay: wallClock(Date.parse(input.dueAt), input.timeZone)
                  .day,
              }
            : null,
        })
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "internal_task.created",
        entityId: task.id,
      });
      return task;
    });
  }

  async change(
    principal: Principal,
    input: z.infer<typeof changeInternalTaskSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(s.internalTasks)
        .where(
          and(
            eq(s.internalTasks.id, input.taskId),
            eq(s.internalTasks.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      await lockContactDirectory(tx, input.organizationId);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, found.productId);
      const [task] = await tx
        .select()
        .from(s.internalTasks)
        .where(eq(s.internalTasks.id, found.id))
        .for("update");
      if (!task) throw new DomainError("NOT_FOUND", 404);
      if (task.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const relationshipId =
        input.relationshipId !== undefined
          ? input.relationshipId
          : task.relationshipId;
      await validateRelationship(
        tx,
        input.organizationId,
        task.productId,
        relationshipId,
      );
      const ownerId = input.ownerId ?? task.ownerId;
      await validateOwner(tx, input.organizationId, task.productId, ownerId);
      if (input.command === "reopen" && task.status === "open") return task;
      if (input.command === "complete" && task.status !== "open")
        throw new DomainError("ACTION_COMPLETED", 409);
      const timeZone = input.timeZone ?? task.timeZone;
      const dueAt = input.dueAt ? new Date(input.dueAt) : task.dueAt;
      const repeat =
        input.recurrence !== undefined ? input.recurrence : task.recurrence;
      const recurrence = repeat
        ? {
            ...repeat,
            anchorDay:
              (input.recurrence?.frequency !== undefined &&
                input.recurrence.frequency !== task.recurrence?.frequency) ||
              (input.recurrence?.interval !== undefined &&
                input.recurrence.interval !== task.recurrence?.interval) ||
              dueAt.getTime() !== task.dueAt.getTime() ||
              timeZone !== task.timeZone
                ? wallClock(dueAt.getTime(), timeZone).day
                : (task.recurrence?.anchorDay ??
                  wallClock(dueAt.getTime(), timeZone).day),
          }
        : null;
      const recurring = input.command === "complete" && recurrence;
      const [result] = await tx
        .update(s.internalTasks)
        .set({
          relationshipId,
          ownerId,
          timeZone,
          recurrence,
          title: input.title ?? task.title,
          description: input.description ?? task.description,
          dueAt: recurring
            ? nextInternalTaskDue(dueAt, timeZone, recurrence, this.clock())
            : dueAt,
          status:
            input.command === "reopen" || recurring
              ? "open"
              : input.command === "complete"
                ? "completed"
                : task.status,
          version: task.version + 1,
        })
        .where(
          and(
            eq(s.internalTasks.id, task.id),
            eq(s.internalTasks.version, input.version),
          ),
        )
        .returning();
      if (!result) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: task.organizationId,
        productId: task.productId,
        actorId: principal.userId,
        type:
          input.command === "complete"
            ? "internal_task.completed"
            : input.command === "reopen"
              ? "internal_task.reopened"
              : "internal_task.saved",
        entityId: task.id,
      });
      if (recurring)
        await tx.insert(s.changeEvents).values({
          organizationId: task.organizationId,
          productId: task.productId,
          actorId: principal.userId,
          type: "internal_task.recurred",
          entityId: task.id,
        });
      return result;
    });
  }
}
