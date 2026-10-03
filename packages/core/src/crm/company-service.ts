import { and, asc, eq, isNull, type SQL, schema, sql } from '@gravity/db';
import { notFound } from '@gravity/shared/errors';
import { assertCan } from '@gravity/shared/policy';
import type { CompanyRow } from '@gravity/shared/records';
import {
  type CompanyInput,
  companyInputSchema,
  companyPatchSchema,
  type FieldsMeta,
} from '@gravity/shared/validators';
import { arrayOverlaps } from 'drizzle-orm';
import type { z } from 'zod';
import { type Executor, newId, requireRow } from '../internal.ts';
import { diffValues, recordActivity } from './activity-service.ts';
import { asConflict } from './conflicts.ts';
import {
  peopleCurrentlyAt,
  reannounceLeadsOfPeopleIn,
  reannouncePeopleIn,
} from './derived-rows.ts';
import { mergeFieldInputIn, NO_STORED_FIELDS } from './field-merge.ts';
import { companyRowOf } from './rows.ts';
import { companyScopes } from './scopes.ts';
import {
  retryOnUniqueViolation,
  type SyncBatch,
  type WithActions,
  withBatch,
} from './sync-batch.ts';
import { lowercased, union } from './value-sets.ts';
import type { WriteContext } from './write-context.ts';

export interface CompanyUpsert {
  readonly company: CompanyRow;
  readonly created: boolean;
}

export interface CompanyQueryOptions {
  readonly orderBy?: readonly SQL[];
  readonly limit?: number;
}

type StoredCompany = typeof schema.company.$inferSelect;
type CompanyPatch = z.infer<typeof companyPatchSchema>;

const COMPANY_DIFF_KEYS = [
  'name',
  'domains',
  'primaryDomain',
  'size',
  'segment',
  'location',
  'fields',
] as const;

export async function liveCompany(
  executor: Executor,
  organizationId: string,
  companyId: string,
  lock = false,
) {
  const query = executor
    .select()
    .from(schema.company)
    .where(
      and(
        eq(schema.company.id, companyId),
        eq(schema.company.organizationId, organizationId),
        isNull(schema.company.archivedAt),
      ),
    )
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) throw notFound('That company does not exist.');
  return row;
}

export async function selectCompanyRows(
  executor: Executor,
  organizationId: string,
  where: SQL | undefined,
  options: CompanyQueryOptions = {},
): Promise<CompanyRow[]> {
  const query = executor
    .select()
    .from(schema.company)
    .where(and(eq(schema.company.organizationId, organizationId), where))
    .orderBy(...(options.orderBy ?? [asc(schema.company.name), asc(schema.company.id)]));
  const rows = options.limit === undefined ? await query : await query.limit(options.limit);
  return rows.map(companyRowOf);
}

export async function companyRowById(
  executor: Executor,
  organizationId: string,
  companyId: string,
): Promise<CompanyRow> {
  const [row] = await selectCompanyRows(
    executor,
    organizationId,
    and(eq(schema.company.id, companyId), isNull(schema.company.archivedAt)),
    { limit: 1 },
  );
  if (row === undefined) throw notFound('That company does not exist.');
  return row;
}

async function findCompanyMatch(batch: SyncBatch, input: CompanyInput) {
  const live = and(
    eq(schema.company.organizationId, batch.organizationId),
    isNull(schema.company.archivedAt),
  );
  const byDomain = input.domains.length > 0;
  const [row] = await batch.tx
    .select()
    .from(schema.company)
    .where(
      and(
        live,
        byDomain
          ? arrayOverlaps(schema.company.domains, input.domains)
          : sql`lower(${schema.company.name}) = lower(${input.name})`,
      ),
    )
    .orderBy(asc(schema.company.createdAt), asc(schema.company.id))
    .limit(1)
    .for('update');
  return row;
}

function emitCompany(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update',
  company: CompanyRow,
): void {
  batch.emit({
    syncId,
    action,
    model: 'company',
    modelId: company.id,
    data: company,
    scopes: companyScopes(batch.organizationId, company.id),
  });
}

async function saveCompanyChangesIn(
  batch: SyncBatch,
  existing: StoredCompany,
  next: CompanyRow,
  fieldsMeta: FieldsMeta | null,
): Promise<CompanyRow> {
  const before = companyRowOf(existing);
  const changes = diffValues(before, next, COMPANY_DIFF_KEYS);
  if (Object.keys(changes).length === 0) return before;
  const syncId = await batch.nextSyncId();
  const [row] = await batch.tx
    .update(schema.company)
    .set({
      name: next.name,
      domains: next.domains,
      primaryDomain: next.primaryDomain,
      size: next.size,
      segment: next.segment,
      location: next.location,
      fields: next.fields,
      ...(fieldsMeta === null ? {} : { fieldsMeta }),
      syncId,
      updatedAt: new Date(),
    })
    .where(eq(schema.company.id, existing.id))
    .returning();
  const company = companyRowOf(requireRow(row, 'That company does not exist.'));
  emitCompany(batch, syncId, 'update', company);
  await recordActivity(batch, {
    kind: 'company.updated',
    payload: { companyId: company.id, changes },
    links: [{ entityType: 'company', entityId: company.id }],
  });
  if (changes['name'] !== undefined) {
    const people = await peopleCurrentlyAt(batch, company.id);
    await reannouncePeopleIn(batch, people);
    await reannounceLeadsOfPeopleIn(batch, people);
  }
  return company;
}

async function insertCompanyIn(batch: SyncBatch, input: CompanyInput): Promise<CompanyRow> {
  const merged = await mergeFieldInputIn(batch, 'company', NO_STORED_FIELDS, input.fields);
  const syncId = await batch.nextSyncId();
  const [row] = await batch.tx
    .insert(schema.company)
    .values({
      id: newId(),
      organizationId: batch.organizationId,
      name: input.name,
      domains: input.domains,
      primaryDomain: input.domains[0] ?? null,
      size: input.size,
      segment: input.segment,
      location: input.location,
      fields: merged.fields,
      fieldsMeta: merged.meta,
      syncId,
    })
    .returning();
  const company = companyRowOf(requireRow(row, 'The company could not be created.'));
  emitCompany(batch, syncId, 'insert', company);
  await recordActivity(batch, {
    kind: 'company.created',
    payload: { companyId: company.id, name: company.name },
    links: [{ entityType: 'company', entityId: company.id }],
  });
  return company;
}

export async function upsertCompanyIn(batch: SyncBatch, raw: CompanyInput): Promise<CompanyUpsert> {
  const input: CompanyInput = { ...raw, domains: lowercased(raw.domains) };
  const existing = await findCompanyMatch(batch, input);
  if (existing === undefined)
    return { company: await insertCompanyIn(batch, input), created: true };
  const merged = await mergeFieldInputIn(batch, 'company', existing, input.fields);
  const next: CompanyRow = {
    ...companyRowOf(existing),
    domains: union(existing.domains, input.domains),
    primaryDomain: existing.primaryDomain ?? input.domains[0] ?? null,
    size: existing.size ?? input.size,
    segment: existing.segment ?? input.segment,
    location: existing.location ?? input.location,
    fields: merged.fields,
  };
  return {
    company: await saveCompanyChangesIn(batch, existing, next, merged.meta),
    created: false,
  };
}

function patchedCompany(
  existing: StoredCompany,
  patch: CompanyPatch,
  fields: Record<string, unknown> | null,
): CompanyRow {
  const domains = patch.domains === undefined ? undefined : lowercased(patch.domains);
  return {
    ...companyRowOf(existing),
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(domains === undefined ? {} : { domains, primaryDomain: domains[0] ?? null }),
    ...(patch.size === undefined ? {} : { size: patch.size }),
    ...(patch.segment === undefined ? {} : { segment: patch.segment }),
    ...(patch.location === undefined ? {} : { location: patch.location }),
    ...(fields === null ? {} : { fields }),
  };
}

export async function upsertCompany(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<CompanyUpsert>> {
  assertCan(context.principal, 'record:write');
  const parsed = companyInputSchema.parse(input);
  try {
    return await retryOnUniqueViolation(() =>
      withBatch(context, (batch) => upsertCompanyIn(batch, parsed)),
    );
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function updateCompany(
  context: WriteContext,
  companyId: string,
  input: unknown,
): Promise<WithActions<{ company: CompanyRow }>> {
  assertCan(context.principal, 'record:write');
  const parsed = companyPatchSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => {
      const existing = await liveCompany(batch.tx, batch.organizationId, companyId, true);
      const merged =
        parsed.fields === undefined
          ? null
          : await mergeFieldInputIn(batch, 'company', existing, parsed.fields);
      const next = patchedCompany(existing, parsed, merged?.fields ?? null);
      return { company: await saveCompanyChangesIn(batch, existing, next, merged?.meta ?? null) };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}
