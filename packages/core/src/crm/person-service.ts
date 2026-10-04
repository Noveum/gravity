import { and, asc, eq, isNull, type SQL, schema } from '@gravity/db';
import { assertCan } from '@gravity/shared/policy';
import type { CompanyRow, PersonRow } from '@gravity/shared/records';
import {
  type CompanyRef,
  type FieldsMeta,
  type PersonInput,
  personInputSchema,
  personPatchSchema,
} from '@gravity/shared/validators';
import { arrayOverlaps } from 'drizzle-orm';
import type { z } from 'zod';
import { type Executor, newId, requireRow } from '../internal.ts';
import { diffValues, recordActivity } from './activity-service.ts';
import { liveCompany, upsertCompanyIn } from './company-service.ts';
import { asConflict } from './conflicts.ts';
import { emitPerson, reannounceLeadsOfPeopleIn, reannouncePeopleIn } from './derived-rows.ts';
import { type EmploymentWrite, writeEmploymentIn } from './employment-service.ts';
import { mergeFieldInputIn, NO_STORED_FIELDS } from './field-merge.ts';
import { livePerson, personRowById } from './person-lookup.ts';
import { companyRowOf } from './rows.ts';
import {
  retryOnUniqueViolation,
  type SyncBatch,
  type WithActions,
  withBatch,
} from './sync-batch.ts';
import { lowercased, union } from './value-sets.ts';
import type { WriteContext } from './write-context.ts';

export {
  type PersonQueryOptions,
  personRowById,
  selectPersonRows,
} from './person-lookup.ts';

export type PersonMatch = 'source_id' | 'linkedin_provider_id' | 'email' | 'linkedin_url';

export interface PersonUpsert {
  readonly person: PersonRow;
  readonly company: CompanyRow | null;
  readonly created: boolean;
  readonly matchedBy: PersonMatch | null;
}

interface PendingPersonAction {
  readonly syncId: number;
  readonly action: 'insert' | 'update';
  readonly changes: Record<string, unknown>;
}

export type StoredPerson = typeof schema.person.$inferSelect;
type PersonPatch = z.infer<typeof personPatchSchema>;

export const PERSON_DIFF_KEYS = [
  'name',
  'emails',
  'primaryEmail',
  'phones',
  'linkedinUrl',
  'linkedinProviderId',
  'location',
  'timezone',
  'doNotContact',
  'fields',
] as const;

const LEAD_DERIVED_KEYS = ['name', 'primaryEmail', 'linkedinUrl'] as const;

function touchesLeads(pending: PendingPersonAction | null): boolean {
  return pending?.action === 'update' && LEAD_DERIVED_KEYS.some((key) => key in pending.changes);
}

export interface PersonMatchOptions {
  readonly lock: boolean;
  readonly preferredId?: string | null | undefined;
}

export async function findPersonMatch(
  executor: Executor,
  organizationId: string,
  input: PersonInput,
  options: PersonMatchOptions,
): Promise<{ row: StoredPerson; matchedBy: PersonMatch } | null> {
  const live = and(
    eq(schema.person.organizationId, organizationId),
    isNull(schema.person.archivedAt),
  );
  const preferredId = options.preferredId ?? null;
  const probes: [PersonMatch, SQL | undefined][] = [
    ['source_id', preferredId === null ? undefined : eq(schema.person.id, preferredId)],
    [
      'linkedin_provider_id',
      input.linkedinProviderId === null
        ? undefined
        : eq(schema.person.linkedinProviderId, input.linkedinProviderId),
    ],
    [
      'email',
      input.emails.length === 0 ? undefined : arrayOverlaps(schema.person.emails, input.emails),
    ],
    [
      'linkedin_url',
      input.linkedinUrl === null ? undefined : eq(schema.person.linkedinUrl, input.linkedinUrl),
    ],
  ];
  for (const [matchedBy, condition] of probes) {
    if (condition === undefined) continue;
    const query = executor
      .select()
      .from(schema.person)
      .where(and(live, condition))
      .orderBy(asc(schema.person.createdAt), asc(schema.person.id))
      .limit(1);
    const [row] = options.lock ? await query.for('update') : await query;
    if (row !== undefined) return { row, matchedBy };
  }
  return null;
}

async function resolveCompanyRef(batch: SyncBatch, ref: CompanyRef): Promise<CompanyRow> {
  if ('id' in ref) {
    return companyRowOf(await liveCompany(batch.tx, batch.organizationId, ref.id, 'share'));
  }
  const base = { size: null, segment: null, location: null, fields: {} };
  if ('domain' in ref) {
    return (
      await upsertCompanyIn(batch, { ...base, name: ref.name ?? ref.domain, domains: [ref.domain] })
    ).company;
  }
  return (await upsertCompanyIn(batch, { ...base, name: ref.name, domains: [] })).company;
}

async function insertPersonIn(
  batch: SyncBatch,
  input: PersonInput,
): Promise<{ personId: string; pending: PendingPersonAction }> {
  const merged = await mergeFieldInputIn(batch, 'person', NO_STORED_FIELDS, input.fields);
  const syncId = await batch.nextSyncId();
  const [row] = await batch.tx
    .insert(schema.person)
    .values({
      id: newId(),
      organizationId: batch.organizationId,
      name: input.name,
      emails: input.emails,
      primaryEmail: input.emails[0] ?? null,
      phones: input.phones,
      linkedinUrl: input.linkedinUrl,
      linkedinProviderId: input.linkedinProviderId,
      location: input.location,
      timezone: input.timezone,
      doNotContact: input.doNotContact,
      fields: merged.fields,
      fieldsMeta: merged.meta,
      syncId,
    })
    .returning();
  return {
    personId: requireRow(row, 'The person could not be created.').id,
    pending: { syncId, action: 'insert', changes: {} },
  };
}

async function savePersonChangesIn(
  batch: SyncBatch,
  existing: StoredPerson,
  next: StoredPerson,
  fieldsMeta: FieldsMeta | null,
): Promise<PendingPersonAction | null> {
  const changes = diffValues(existing, next, PERSON_DIFF_KEYS);
  if (Object.keys(changes).length === 0) return null;
  const syncId = await batch.nextSyncId();
  await batch.tx
    .update(schema.person)
    .set({
      name: next.name,
      emails: next.emails,
      primaryEmail: next.primaryEmail,
      phones: next.phones,
      linkedinUrl: next.linkedinUrl,
      linkedinProviderId: next.linkedinProviderId,
      location: next.location,
      timezone: next.timezone,
      doNotContact: next.doNotContact,
      fields: next.fields,
      ...(fieldsMeta === null ? {} : { fieldsMeta }),
      syncId,
      updatedAt: new Date(),
    })
    .where(eq(schema.person.id, existing.id));
  return { syncId, action: 'update', changes };
}

export function mergedPersonValues(
  existing: StoredPerson,
  input: PersonInput,
  fields: Record<string, unknown>,
): StoredPerson {
  return {
    ...existing,
    emails: union(existing.emails, input.emails),
    primaryEmail: existing.primaryEmail ?? input.emails[0] ?? null,
    phones: union(existing.phones, input.phones),
    linkedinUrl: existing.linkedinUrl ?? input.linkedinUrl,
    linkedinProviderId: existing.linkedinProviderId ?? input.linkedinProviderId,
    location: existing.location ?? input.location,
    timezone: existing.timezone ?? input.timezone,
    doNotContact: existing.doNotContact || input.doNotContact,
    fields,
  };
}

async function mergePersonIn(
  batch: SyncBatch,
  existing: StoredPerson,
  input: PersonInput,
): Promise<PendingPersonAction | null> {
  const merged = await mergeFieldInputIn(batch, 'person', existing, input.fields);
  return await savePersonChangesIn(
    batch,
    existing,
    mergedPersonValues(existing, input, merged.fields),
    merged.meta,
  );
}

async function announcePersonIn(
  batch: SyncBatch,
  person: PersonRow,
  pending: PendingPersonAction,
): Promise<void> {
  emitPerson(batch, pending.syncId, pending.action, person);
  const created = pending.action === 'insert';
  await recordActivity(batch, {
    kind: created ? 'person.created' : 'person.updated',
    payload: created
      ? { personId: person.id, name: person.name }
      : { personId: person.id, changes: pending.changes },
    links: [{ entityType: 'person', entityId: person.id }],
  });
}

async function writeCurrentJobIn(
  batch: SyncBatch,
  personId: string,
  company: CompanyRow | null,
  title: string | null,
): Promise<EmploymentWrite | null> {
  if (company === null) return null;
  return await writeEmploymentIn(batch, {
    personId,
    companyId: company.id,
    title,
    startedAt: null,
    isCurrent: true,
  });
}

function patchedPerson(
  existing: StoredPerson,
  patch: PersonPatch,
  fields: Record<string, unknown> | null,
): StoredPerson {
  const emails = patch.emails === undefined ? undefined : lowercased(patch.emails);
  return {
    ...existing,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(emails === undefined ? {} : { emails, primaryEmail: emails[0] ?? null }),
    ...(patch.phones === undefined ? {} : { phones: patch.phones }),
    ...(patch.linkedinUrl === undefined ? {} : { linkedinUrl: patch.linkedinUrl }),
    ...(patch.location === undefined ? {} : { location: patch.location }),
    ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
    ...(patch.doNotContact === undefined ? {} : { doNotContact: patch.doNotContact }),
    ...(fields === null ? {} : { fields }),
  };
}

export async function upsertPersonIn(
  batch: SyncBatch,
  raw: PersonInput,
  preferredId: string | null = null,
): Promise<PersonUpsert> {
  const input: PersonInput = { ...raw, emails: lowercased(raw.emails) };
  const match = await findPersonMatch(batch.tx, batch.organizationId, input, {
    lock: true,
    preferredId,
  });
  const written =
    match === null
      ? await insertPersonIn(batch, input)
      : { personId: match.row.id, pending: await mergePersonIn(batch, match.row, input) };
  const company = input.company === null ? null : await resolveCompanyRef(batch, input.company);
  const job = await writeCurrentJobIn(batch, written.personId, company, input.title);
  let person = await personRowById(batch.tx, batch.organizationId, written.personId);
  if (written.pending !== null) {
    await announcePersonIn(batch, person, written.pending);
  } else if (job?.personChanged === true) {
    const [announced] = await reannouncePeopleIn(batch, [person.id]);
    person = announced ?? person;
  }
  if (match !== null && (job?.leadsChanged === true || touchesLeads(written.pending))) {
    await reannounceLeadsOfPeopleIn(batch, [person.id]);
  }
  return { person, company, created: match === null, matchedBy: match?.matchedBy ?? null };
}

export async function upsertPerson(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<PersonUpsert>> {
  assertCan(context.principal, 'record:write');
  const parsed = personInputSchema.parse(input);
  try {
    return await retryOnUniqueViolation(() =>
      withBatch(context, (batch) => upsertPersonIn(batch, parsed)),
    );
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function updatePerson(
  context: WriteContext,
  personId: string,
  input: unknown,
): Promise<WithActions<{ person: PersonRow }>> {
  assertCan(context.principal, 'record:write');
  const parsed = personPatchSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => {
      const existing = await livePerson(batch.tx, batch.organizationId, personId, 'update');
      const merged =
        parsed.fields === undefined
          ? null
          : await mergeFieldInputIn(batch, 'person', existing, parsed.fields);
      const next = patchedPerson(existing, parsed, merged?.fields ?? null);
      const pending = await savePersonChangesIn(batch, existing, next, merged?.meta ?? null);
      const person = await personRowById(batch.tx, batch.organizationId, personId);
      if (pending === null) return { person };
      await announcePersonIn(batch, person, pending);
      if (touchesLeads(pending)) await reannounceLeadsOfPeopleIn(batch, [personId]);
      return { person };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}
