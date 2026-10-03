import { and, db, desc, eq, ilike, inArray, or, type SQL, schema, sql } from '@gravity/db';
import {
  ACTIVITY_ENTITY_TYPES,
  type ActivityKind,
  TIMELINE_PREFIXES,
  type TimelineFilter,
} from '@gravity/shared/constants';
import { scopes } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import type { ActivityLinkRow, ActivityRow } from '@gravity/shared/records';
import { timelineQuerySchema } from '@gravity/shared/validators';
import { newId, requireRow } from '../internal.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { activityRowOf, oneOf } from './rows.ts';
import type { SyncBatch } from './sync-batch.ts';
import { writeActor } from './write-context.ts';

export interface ActivityInput {
  readonly kind: ActivityKind;
  readonly payload: Record<string, unknown>;
  readonly links: readonly ActivityLinkRow[];
  readonly occurredAt?: Date;
  readonly externalId?: string;
}

export interface TimelinePage {
  readonly activities: ActivityRow[];
  readonly nextCursor: string | null;
}

function sortLinks(links: readonly ActivityLinkRow[]): ActivityLinkRow[] {
  return [...links].sort(
    (a, b) =>
      ACTIVITY_ENTITY_TYPES.indexOf(a.entityType) - ACTIVITY_ENTITY_TYPES.indexOf(b.entityType) ||
      a.entityId.localeCompare(b.entityId, 'en'),
  );
}

function dedupeLinks(links: readonly ActivityLinkRow[]): ActivityLinkRow[] {
  const seen = new Set<string>();
  return sortLinks(
    links.filter((link) => {
      const key = `${link.entityType}:${link.entityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function activityScopes(organizationId: string, links: readonly ActivityLinkRow[]): string[] {
  return [
    scopes.workspace(organizationId),
    ...links.flatMap((link) => {
      if (link.entityType === 'person') return [scopes.person(link.entityId)];
      if (link.entityType === 'company') return [scopes.company(link.entityId)];
      return [];
    }),
  ];
}

export function diffValues<T extends object>(
  before: T,
  after: T,
  keys: readonly (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}

export async function recordActivity(batch: SyncBatch, input: ActivityInput): Promise<ActivityRow> {
  const syncId = await batch.nextSyncId();
  const occurredAt = input.occurredAt ?? new Date();
  const [inserted] = await batch.tx
    .insert(schema.activity)
    .values({
      id: newId(),
      organizationId: batch.organizationId,
      kind: input.kind,
      actor: writeActor(batch.context),
      occurredAt,
      payload: input.payload,
      externalId: input.externalId ?? null,
      syncId,
    })
    .returning();
  const row = requireRow(inserted, 'The activity could not be recorded.');
  const links = dedupeLinks(input.links);
  if (links.length > 0) {
    await batch.tx.insert(schema.activityLink).values(
      links.map((link) => ({
        activityId: row.id,
        organizationId: batch.organizationId,
        entityType: link.entityType,
        entityId: link.entityId,
        occurredAt,
      })),
    );
  }
  const activity = activityRowOf(row, links);
  batch.emit({
    syncId,
    action: 'insert',
    model: 'activity',
    modelId: activity.id,
    data: activity,
    scopes: activityScopes(batch.organizationId, links),
  });
  return activity;
}

function kindFilter(filter: TimelineFilter): SQL | undefined {
  if (filter === 'all') return undefined;
  return or(
    ...TIMELINE_PREFIXES[filter].map((prefix) => ilike(schema.activity.kind, `${prefix}%`)),
  );
}

export async function listTimeline(principal: Principal, input: unknown): Promise<TimelinePage> {
  assertCan(principal, 'record:read');
  const query = timelineQuerySchema.parse(input);
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor, 2);
  const rows = await db
    .select({ activity: schema.activity })
    .from(schema.activityLink)
    .innerJoin(schema.activity, eq(schema.activity.id, schema.activityLink.activityId))
    .where(
      and(
        eq(schema.activityLink.organizationId, principal.organizationId),
        eq(schema.activityLink.entityType, query.subjectType),
        eq(schema.activityLink.entityId, query.subjectId),
        kindFilter(query.filter),
        cursor === null
          ? undefined
          : sql`(${schema.activityLink.occurredAt}, ${schema.activityLink.activityId}) < (${String(cursor[0])}::timestamptz, ${String(cursor[1])})`,
      ),
    )
    .orderBy(desc(schema.activityLink.occurredAt), desc(schema.activityLink.activityId))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit).map((row) => row.activity);
  const links =
    page.length === 0
      ? []
      : await db
          .select()
          .from(schema.activityLink)
          .where(
            and(
              eq(schema.activityLink.organizationId, principal.organizationId),
              inArray(
                schema.activityLink.activityId,
                page.map((row) => row.id),
              ),
            ),
          );
  const activities = page.map((row) =>
    activityRowOf(
      row,
      sortLinks(
        links
          .filter((link) => link.activityId === row.id)
          .map((link) => ({
            entityType: oneOf(ACTIVITY_ENTITY_TYPES, link.entityType, 'person'),
            entityId: link.entityId,
          })),
      ),
    ),
  );
  const last = page.at(-1);
  return {
    activities,
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor([last.occurredAt.toISOString(), last.id])
        : null,
  };
}
