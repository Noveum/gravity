import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { appUrl } from "../auth/options";
import { publishChange } from "../core/changes";
import { lockContactDirectory } from "../core/contact-history";
import { preciseOffsetInstantSchema } from "../core/datetime";
import { authorize, DomainError, type Principal } from "../core/policy";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { encryptionConfigured, seal, unseal } from "./security";

export const yoduEventKinds = [
  "signup",
  "onboarding",
  "payment",
  "activation",
] as const;
// PostgreSQL canonicalizes UUIDs; use that same form for encrypted source AAD
// and idempotent comparisons even when callers supply uppercase UUIDs.
const uuid = z.uuid().toLowerCase();
export const yoduScopeSchema = z.object({
  organizationId: uuid,
  productId: uuid,
});
export const listYoduSourcesSchema = yoduScopeSchema.extend({
  bindingsCursor: z.string().min(1).max(500).optional(),
});
const externalId = z.string().trim().min(1).max(200);
export const createYoduSourceSchema = yoduScopeSchema.extend({
  sourceId: uuid,
  label: z.string().trim().min(1).max(100),
});
export const updateYoduSourceSchema = yoduScopeSchema
  .extend({
    sourceId: uuid,
    version: z.number().int().positive(),
    label: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    rotateSecret: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.label !== undefined ||
      value.enabled !== undefined ||
      value.rotateSecret,
  );
export const bindYoduSubjectSchema = yoduScopeSchema.extend({
  sourceId: uuid,
  externalSubjectId: externalId,
  relationshipId: uuid,
  expectedVersion: z.number().int().positive().optional(),
});
export const listYoduEventsSchema = yoduScopeSchema.extend({
  sourceId: uuid.optional(),
  relationshipId: uuid.optional(),
  unmatched: z.enum(["true", "false"]).default("false"),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
// This is Gravity's bridge contract, not an undocumented Yodu vendor webhook.
export const yoduEventSchema = z.strictObject({
  eventId: externalId,
  externalSubjectId: externalId,
  kind: z.enum(yoduEventKinds),
  occurredAt: preciseOffsetInstantSchema,
});
const positionSchema = z.strictObject({
  receivedAt: z.iso.datetime(),
  id: uuid,
});
const bindingPositionSchema = z.strictObject({
  externalSubjectId: externalId,
  id: uuid,
});
const sourceContext = (row: typeof s.yoduSources.$inferSelect) =>
  `${row.organizationId}:${row.productId}:${row.id}:yodu`;
const hidesArchivedPeople = (principal: Principal) =>
  principal.source === "mcp" && principal.readOnly !== false;
function sourceView(row: typeof s.yoduSources.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productId: row.productId,
    label: row.label,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.createdAt,
    webhookUrl: `${appUrl()}/api/webhooks/yodu?sourceId=${row.id}`,
    verification: "signed_source_attestation" as const,
  };
}
async function manageProduct(
  db: Database,
  principal: Principal,
  input: z.infer<typeof yoduScopeSchema>,
) {
  let permission = await authorize(
    db,
    principal,
    input.organizationId,
    input.productId,
    true,
  );
  if (permission.membership.role !== "admin")
    throw new DomainError("FORBIDDEN", 403);
  // Membership and product-grant changes take the organization update lock.
  // Acquire its shared lock before waiting on product/source rows, then refresh
  // authority: a revocation may have committed since the preliminary check.
  await lockContactDirectory(db, input.organizationId);
  permission = await authorize(
    db,
    principal,
    input.organizationId,
    input.productId,
    true,
  );
  if (permission.membership.role !== "admin")
    throw new DomainError("FORBIDDEN", 403);
  const [product] = await db
    .select({ archivedAt: s.products.archivedAt })
    .from(s.products)
    .where(
      and(
        eq(s.products.id, input.productId),
        eq(s.products.organizationId, input.organizationId),
      ),
    )
    .for("share");
  if (!product || product.archivedAt) throw new DomainError("NOT_FOUND", 404);
}
async function sourceFor(
  db: Database,
  input: z.infer<typeof yoduScopeSchema> & { sourceId: string },
) {
  const [source] = await db
    .select()
    .from(s.yoduSources)
    .where(
      and(
        eq(s.yoduSources.organizationId, input.organizationId),
        eq(s.yoduSources.productId, input.productId),
        eq(s.yoduSources.id, input.sourceId),
      ),
    )
    .for("update");
  if (!source) throw new DomainError("NOT_FOUND", 404);
  return source;
}
async function recordChange(
  db: Database,
  principal: Principal,
  input: z.infer<typeof yoduScopeSchema>,
  entityId: string,
  type: string,
) {
  await db.insert(s.changeEvents).values({
    organizationId: input.organizationId,
    productId: input.productId,
    actorId: principal.userId,
    entityId,
    type,
  });
}
export function verifyYoduSignature(
  raw: Uint8Array,
  signature: string | null,
  secret: string,
  now = Date.now(),
) {
  const match = signature?.match(/^t=(\d{10,12}),v1=([a-f0-9]{64})$/);
  if (!match || !secret) return false;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || Math.abs(now - seconds * 1000) > 300000)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${match[1]}.`)
    .update(raw)
    .digest();
  return timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}

export class YoduService {
  constructor(
    private db: Database,
    private now = Date.now,
  ) {}

  async sources(
    principal: Principal,
    input: z.input<typeof listYoduSourcesSchema>,
  ) {
    const value = listYoduSourcesSchema.parse(input);
    const permission = await authorize(
      this.db,
      principal,
      value.organizationId,
      value.productId,
    );
    let position: z.infer<typeof bindingPositionSchema> | undefined;
    if (value.bindingsCursor) {
      try {
        position = bindingPositionSchema.parse(
          JSON.parse(
            Buffer.from(value.bindingsCursor, "base64url").toString("utf8"),
          ),
        );
      } catch {
        throw new DomainError("INVALID_INPUT", 400);
      }
    }
    const [sources, bindings] = await Promise.all([
      this.db
        .select()
        .from(s.yoduSources)
        .where(
          and(
            eq(s.yoduSources.organizationId, value.organizationId),
            eq(s.yoduSources.productId, value.productId),
          ),
        )
        .orderBy(asc(s.yoduSources.label), asc(s.yoduSources.id)),
      this.db
        .select({
          id: s.yoduBindings.id,
          sourceId: s.yoduBindings.sourceId,
          externalSubjectId: s.yoduBindings.externalSubjectId,
          relationshipId: s.yoduBindings.relationshipId,
          version: s.yoduBindings.version,
        })
        .from(s.yoduBindings)
        .innerJoin(
          s.relationships,
          and(
            eq(s.relationships.id, s.yoduBindings.relationshipId),
            eq(s.relationships.organizationId, s.yoduBindings.organizationId),
            eq(s.relationships.productId, s.yoduBindings.productId),
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
            eq(s.yoduBindings.organizationId, value.organizationId),
            eq(s.yoduBindings.productId, value.productId),
            hidesArchivedPeople(principal)
              ? isNull(s.people.archivedAt)
              : undefined,
            position
              ? or(
                  gt(
                    s.yoduBindings.externalSubjectId,
                    position.externalSubjectId,
                  ),
                  and(
                    eq(
                      s.yoduBindings.externalSubjectId,
                      position.externalSubjectId,
                    ),
                    gt(s.yoduBindings.id, position.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(s.yoduBindings.externalSubjectId), asc(s.yoduBindings.id))
        .limit(201),
    ]);
    const page = bindings.slice(0, 200);
    const last = page.at(-1);
    return {
      sources: sources.map(sourceView),
      bindings: page,
      bindingsTruncated: bindings.length > 200,
      nextBindingsCursor:
        bindings.length > 200 && last
          ? Buffer.from(
              JSON.stringify({
                externalSubjectId: last.externalSubjectId,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
      configured: encryptionConfigured(),
      canManage:
        permission.membership.role === "admin" &&
        !principal.readOnly &&
        (principal.source !== "mcp" || principal.readOnly === false) &&
        !permission.products.find((product) => product.id === value.productId)
          ?.archivedAt,
    };
  }

  async createSource(
    principal: Principal,
    input: z.input<typeof createYoduSourceSchema>,
  ) {
    const value = createYoduSourceSchema.parse(input);
    if (!encryptionConfigured())
      throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    return this.db.transaction(async (tx) => {
      await manageProduct(tx, principal, value);
      const secret = randomBytes(32).toString("base64url");
      const context = `${value.organizationId}:${value.productId}:${value.sourceId}:yodu`;
      const [source] = await tx
        .insert(s.yoduSources)
        .values({
          id: value.sourceId,
          organizationId: value.organizationId,
          productId: value.productId,
          label: value.label,
          createdBy: principal.userId,
          encryptedSecret: seal(secret, context),
        })
        .onConflictDoNothing()
        .returning();
      if (!source) {
        const existing = await sourceFor(tx, value);
        if (
          existing.label !== value.label ||
          existing.createdBy !== principal.userId
        )
          throw new DomainError("CONFLICT", 409);
        return { ...sourceView(existing), created: false };
      }
      await recordChange(
        tx,
        principal,
        value,
        source.id,
        "yodu.source_created",
      );
      return { ...sourceView(source), created: true, signingSecret: secret };
    });
  }

  async updateSource(
    principal: Principal,
    input: z.input<typeof updateYoduSourceSchema>,
  ) {
    const value = updateYoduSourceSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await manageProduct(tx, principal, value);
      const source = await sourceFor(tx, value);
      if (source.version !== value.version)
        throw new DomainError("CONFLICT", 409);
      const secret = value.rotateSecret
        ? randomBytes(32).toString("base64url")
        : undefined;
      const [updated] = await tx
        .update(s.yoduSources)
        .set({
          label: value.label ?? source.label,
          enabled: value.enabled ?? source.enabled,
          encryptedSecret: secret
            ? seal(secret, sourceContext(source))
            : source.encryptedSecret,
          version: source.version + 1,
        })
        .where(eq(s.yoduSources.id, source.id))
        .returning();
      await recordChange(
        tx,
        principal,
        value,
        source.id,
        secret ? "yodu.secret_rotated" : "yodu.source_updated",
      );
      return {
        ...sourceView(updated),
        ...(secret ? { signingSecret: secret } : {}),
      };
    });
  }

  async bindSubject(
    principal: Principal,
    input: z.input<typeof bindYoduSubjectSchema>,
  ) {
    const value = bindYoduSubjectSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await manageProduct(tx, principal, value);
      await sourceFor(tx, value);
      const [relationship] = await tx
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
            eq(s.relationships.organizationId, value.organizationId),
            eq(s.relationships.productId, value.productId),
            eq(s.relationships.id, value.relationshipId),
            isNull(s.people.archivedAt),
          ),
        )
        .for("share");
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      const [existing] = await tx
        .select()
        .from(s.yoduBindings)
        .where(
          and(
            eq(s.yoduBindings.sourceId, value.sourceId),
            eq(s.yoduBindings.externalSubjectId, value.externalSubjectId),
          ),
        )
        .for("update");
      if (existing) {
        if (
          value.expectedVersion !== undefined &&
          existing.version !== value.expectedVersion
        )
          throw new DomainError("CONFLICT", 409);
        if (existing.relationshipId === value.relationshipId) return existing;
        if (value.expectedVersion === undefined)
          throw new DomainError("CONFLICT", 409);
        const [updated] = await tx
          .update(s.yoduBindings)
          .set({
            relationshipId: value.relationshipId,
            version: existing.version + 1,
          })
          .where(eq(s.yoduBindings.id, existing.id))
          .returning();
        await recordChange(
          tx,
          principal,
          value,
          updated.id,
          "yodu.subject_reassigned",
        );
        return updated;
      }
      if (value.expectedVersion !== undefined)
        throw new DomainError("CONFLICT", 409);
      const [binding] = await tx
        .insert(s.yoduBindings)
        .values({
          organizationId: value.organizationId,
          productId: value.productId,
          sourceId: value.sourceId,
          externalSubjectId: value.externalSubjectId,
          relationshipId: value.relationshipId,
          createdBy: principal.userId,
        })
        .returning();
      await recordChange(
        tx,
        principal,
        value,
        binding.id,
        "yodu.subject_bound",
      );
      return binding;
    });
  }

  async events(
    principal: Principal,
    input: z.input<typeof listYoduEventsSchema>,
  ) {
    const value = listYoduEventsSchema.parse(input);
    await authorize(this.db, principal, value.organizationId, value.productId);
    let position: z.infer<typeof positionSchema> | undefined;
    if (value.cursor) {
      try {
        position = positionSchema.parse(
          JSON.parse(Buffer.from(value.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new DomainError("INVALID_INPUT", 400);
      }
    }
    if (value.relationshipId) {
      const [relationship] = await this.db
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
            eq(s.relationships.organizationId, value.organizationId),
            eq(s.relationships.productId, value.productId),
            eq(s.relationships.id, value.relationshipId),
            hidesArchivedPeople(principal)
              ? isNull(s.people.archivedAt)
              : undefined,
          ),
        );
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
    }
    const rows = await this.db
      .select({
        id: s.yoduEvents.id,
        sourceId: s.yoduEvents.sourceId,
        sourceLabel: s.yoduSources.label,
        sourceEnabled: s.yoduSources.enabled,
        externalSubjectId: s.yoduEvents.externalSubjectId,
        providerEventId: s.yoduEvents.providerEventId,
        kind: s.yoduEvents.kind,
        occurredAt: s.yoduEvents.occurredAt,
        receivedAt: s.yoduEvents.receivedAt,
        payloadHash: s.yoduEvents.payloadHash,
        sourceVersion: s.yoduEvents.sourceVersion,
        relationshipId: s.yoduBindings.relationshipId,
        bindingVersion: s.yoduBindings.version,
      })
      .from(s.yoduEvents)
      .innerJoin(
        s.yoduSources,
        and(
          eq(s.yoduSources.id, s.yoduEvents.sourceId),
          eq(s.yoduSources.organizationId, s.yoduEvents.organizationId),
          eq(s.yoduSources.productId, s.yoduEvents.productId),
        ),
      )
      .leftJoin(
        s.yoduBindings,
        and(
          eq(s.yoduBindings.sourceId, s.yoduEvents.sourceId),
          eq(s.yoduBindings.organizationId, s.yoduEvents.organizationId),
          eq(s.yoduBindings.productId, s.yoduEvents.productId),
          eq(s.yoduBindings.externalSubjectId, s.yoduEvents.externalSubjectId),
        ),
      )
      .leftJoin(
        s.relationships,
        and(
          eq(s.relationships.id, s.yoduBindings.relationshipId),
          eq(s.relationships.organizationId, s.yoduBindings.organizationId),
          eq(s.relationships.productId, s.yoduBindings.productId),
        ),
      )
      .leftJoin(
        s.people,
        and(
          eq(s.people.id, s.relationships.personId),
          eq(s.people.organizationId, s.relationships.organizationId),
        ),
      )
      .where(
        and(
          eq(s.yoduEvents.organizationId, value.organizationId),
          eq(s.yoduEvents.productId, value.productId),
          value.sourceId
            ? eq(s.yoduEvents.sourceId, value.sourceId)
            : undefined,
          value.relationshipId
            ? eq(s.yoduBindings.relationshipId, value.relationshipId)
            : undefined,
          value.unmatched === "true" ? isNull(s.yoduBindings.id) : undefined,
          hidesArchivedPeople(principal)
            ? or(
                isNull(s.yoduBindings.id),
                and(isNotNull(s.people.id), isNull(s.people.archivedAt)),
              )
            : undefined,
          position
            ? or(
                lt(s.yoduEvents.receivedAt, new Date(position.receivedAt)),
                and(
                  eq(s.yoduEvents.receivedAt, new Date(position.receivedAt)),
                  lt(s.yoduEvents.id, position.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(s.yoduEvents.receivedAt), desc(s.yoduEvents.id))
      .limit(value.limit + 1);
    const page = rows.slice(0, value.limit);
    const last = page.at(-1);
    return {
      events: page.map((row) => ({
        ...row,
        verification: "signed_source_attestation" as const,
      })),
      nextCursor:
        rows.length > value.limit && last
          ? Buffer.from(
              JSON.stringify({
                receivedAt: last.receivedAt.toISOString(),
                id: last.id,
              }),
            ).toString("base64url")
          : null,
      coverage: { complete: rows.length <= value.limit, pageSize: value.limit },
    };
  }

  // Only the signed transport calls this method. Business write operations cannot
  // manufacture source-attested events by supplying a verified flag.
  async ingest(sourceId: string, raw: Uint8Array, signature: string | null) {
    const id = uuid.parse(sourceId);
    if (raw.byteLength > 10000) throw new DomainError("FILE_SIZE", 413);
    const now = this.now();
    const result = await this.db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(s.yoduSources)
        .where(eq(s.yoduSources.id, id))
        .for("update");
      if (!source?.enabled) throw new DomainError("UNAUTHORIZED", 401);
      const [product] = await tx
        .select({ archivedAt: s.products.archivedAt })
        .from(s.products)
        .where(
          and(
            eq(s.products.id, source.productId),
            eq(s.products.organizationId, source.organizationId),
          ),
        )
        .for("share");
      if (!product || product.archivedAt)
        throw new DomainError("UNAUTHORIZED", 401);
      const secret = unseal<string>(
        source.encryptedSecret,
        sourceContext(source),
      );
      if (!verifyYoduSignature(raw, signature, secret, now))
        throw new DomainError("UNAUTHORIZED", 401);
      let body: string;
      try {
        body = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      } catch {
        throw new DomainError("INVALID_INPUT", 400);
      }
      const value = yoduEventSchema.parse(JSON.parse(body));
      if (Date.parse(value.occurredAt) > now + 300000)
        throw new DomainError("YODU_EVENT_FUTURE", 400);
      const payloadHash = createHash("sha256").update(raw).digest("hex");
      const [event] = await tx
        .insert(s.yoduEvents)
        .values({
          organizationId: source.organizationId,
          productId: source.productId,
          sourceId: source.id,
          externalSubjectId: value.externalSubjectId,
          providerEventId: value.eventId,
          kind: value.kind,
          occurredAt: new Date(value.occurredAt),
          receivedAt: new Date(now),
          sourceVersion: source.version,
          payloadHash,
        })
        .onConflictDoNothing()
        .returning();
      if (!event) {
        const [previous] = await tx
          .select()
          .from(s.yoduEvents)
          .where(
            and(
              eq(s.yoduEvents.sourceId, source.id),
              eq(s.yoduEvents.providerEventId, value.eventId),
            ),
          );
        if (!previous || previous.payloadHash !== payloadHash)
          throw new DomainError("YODU_EVENT_CONFLICT", 409);
        return {
          organizationId: source.organizationId,
          eventId: previous.id,
          duplicate: true,
        };
      }
      await tx.insert(s.changeEvents).values({
        organizationId: source.organizationId,
        productId: source.productId,
        actorId: `yodu:${source.id}`,
        type: "yodu.event_received",
        entityId: event.id,
      });
      return {
        organizationId: source.organizationId,
        eventId: event.id,
        duplicate: false,
      };
    });
    if (!result.duplicate) publishChange(result.organizationId);
    return {
      received: true,
      eventId: result.eventId,
      duplicate: result.duplicate,
    };
  }
}
export type YoduSources = Awaited<ReturnType<YoduService["sources"]>>;
export type YoduEventPage = Awaited<ReturnType<YoduService["events"]>>;
