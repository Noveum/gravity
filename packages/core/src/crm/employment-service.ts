import { and, asc, eq, inArray, type SQL, schema } from '@gravity/db';
import { notFound } from '@gravity/shared/errors';
import { assertCan } from '@gravity/shared/policy';
import type { EmploymentRow } from '@gravity/shared/records';
import { type EmploymentInput, employmentInputSchema } from '@gravity/shared/validators';
import { newId, requireRow } from '../internal.ts';
import { recordActivity } from './activity-service.ts';
import { liveCompany } from './company-service.ts';
import { emitEmployment, reannounceLeadsOfPeopleIn, reannouncePeopleIn } from './derived-rows.ts';
import { livePerson } from './person-lookup.ts';
import { employmentRowOf } from './rows.ts';
import { type SyncBatch, type WithActions, withBatch } from './sync-batch.ts';
import type { WriteContext } from './write-context.ts';

export interface EmploymentWrite {
  readonly employment: EmploymentRow;
  readonly personChanged: boolean;
  readonly leadsChanged: boolean;
}

type StoredEmployment = typeof schema.employment.$inferSelect;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function reannounceEmploymentChangeIn(
  batch: SyncBatch,
  personId: string,
  write: EmploymentWrite,
): Promise<void> {
  if (write.personChanged) await reannouncePeopleIn(batch, [personId]);
  if (write.leadsChanged) await reannounceLeadsOfPeopleIn(batch, [personId]);
}

interface LockedJob {
  readonly employment: StoredEmployment;
  readonly companyName: string;
}

async function lockPersonRow(batch: SyncBatch, personId: string): Promise<void> {
  await batch.tx
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(
      and(eq(schema.person.id, personId), eq(schema.person.organizationId, batch.organizationId)),
    )
    .for('update');
}

async function lockJobs(batch: SyncBatch, where: SQL | undefined): Promise<LockedJob[]> {
  const jobs = await batch.tx
    .select()
    .from(schema.employment)
    .where(and(eq(schema.employment.organizationId, batch.organizationId), where))
    .orderBy(asc(schema.employment.id))
    .for('update');
  if (jobs.length === 0) return [];
  const companies = await batch.tx
    .select({ id: schema.company.id, name: schema.company.name })
    .from(schema.company)
    .where(
      and(
        eq(schema.company.organizationId, batch.organizationId),
        inArray(
          schema.company.id,
          jobs.map((job) => job.companyId),
        ),
      ),
    );
  return jobs.map((employment) => ({
    employment,
    companyName: requireRow(
      companies.find((company) => company.id === employment.companyId),
      'That company does not exist.',
    ).name,
  }));
}

async function endIn(
  batch: SyncBatch,
  row: StoredEmployment,
  companyName: string,
): Promise<EmploymentRow> {
  const syncId = await batch.nextSyncId();
  const [updated] = await batch.tx
    .update(schema.employment)
    .set({ isCurrent: false, endedAt: today(), syncId, updatedAt: new Date() })
    .where(eq(schema.employment.id, row.id))
    .returning();
  const employment = employmentRowOf(requireRow(updated, 'That job does not exist.'), companyName);
  emitEmployment(batch, syncId, 'update', employment);
  await recordActivity(batch, {
    kind: 'employment.ended',
    payload: { personId: row.personId, companyId: row.companyId, companyName },
    links: [
      { entityType: 'person', entityId: row.personId },
      { entityType: 'company', entityId: row.companyId },
    ],
  });
  return employment;
}

async function retitleIn(
  batch: SyncBatch,
  row: StoredEmployment,
  title: string,
  companyName: string,
): Promise<EmploymentRow> {
  const syncId = await batch.nextSyncId();
  const [updated] = await batch.tx
    .update(schema.employment)
    .set({ title, syncId, updatedAt: new Date() })
    .where(eq(schema.employment.id, row.id))
    .returning();
  const employment = employmentRowOf(requireRow(updated, 'That job does not exist.'), companyName);
  emitEmployment(batch, syncId, 'update', employment);
  return employment;
}

export async function writeEmploymentIn(
  batch: SyncBatch,
  input: EmploymentInput,
): Promise<EmploymentWrite> {
  await livePerson(batch.tx, batch.organizationId, input.personId, 'update');
  const company = await liveCompany(batch.tx, batch.organizationId, input.companyId, 'share');
  const current = await lockJobs(
    batch,
    and(eq(schema.employment.personId, input.personId), eq(schema.employment.isCurrent, true)),
  );
  const same = current.find((entry) => entry.employment.companyId === company.id);
  if (same !== undefined && input.isCurrent) {
    if (input.title === null || input.title === same.employment.title) {
      return {
        employment: employmentRowOf(same.employment, company.name),
        personChanged: false,
        leadsChanged: false,
      };
    }
    const employment = await retitleIn(batch, same.employment, input.title, company.name);
    return { employment, personChanged: true, leadsChanged: false };
  }
  if (input.isCurrent) {
    for (const previous of current) await endIn(batch, previous.employment, previous.companyName);
  }
  const syncId = await batch.nextSyncId();
  const startedAt = input.startedAt === null ? null : input.startedAt.toISOString().slice(0, 10);
  const [row] = await batch.tx
    .insert(schema.employment)
    .values({
      id: newId(),
      organizationId: batch.organizationId,
      personId: input.personId,
      companyId: company.id,
      title: input.title,
      startedAt,
      isCurrent: input.isCurrent,
      syncId,
    })
    .returning();
  const employment = employmentRowOf(
    requireRow(row, 'The job could not be recorded.'),
    company.name,
  );
  emitEmployment(batch, syncId, 'insert', employment);
  await recordActivity(batch, {
    kind: 'employment.started',
    payload: {
      personId: input.personId,
      companyId: company.id,
      companyName: company.name,
      title: input.title,
    },
    links: [
      { entityType: 'person', entityId: input.personId },
      { entityType: 'company', entityId: company.id },
    ],
  });
  return { employment, personChanged: input.isCurrent, leadsChanged: input.isCurrent };
}

export async function addEmploymentIn(
  batch: SyncBatch,
  input: EmploymentInput,
): Promise<EmploymentRow> {
  const written = await writeEmploymentIn(batch, input);
  await reannounceEmploymentChangeIn(batch, input.personId, written);
  return written.employment;
}

export async function addEmployment(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ employment: EmploymentRow }>> {
  assertCan(context.principal, 'record:write');
  const parsed = employmentInputSchema.parse(input);
  return await withBatch(context, async (batch) => ({
    employment: await addEmploymentIn(batch, parsed),
  }));
}

export async function endEmployment(
  context: WriteContext,
  employmentId: string,
): Promise<WithActions<{ employment: EmploymentRow }>> {
  assertCan(context.principal, 'record:write');
  return await withBatch(context, async (batch) => {
    const [target] = await batch.tx
      .select({ personId: schema.employment.personId })
      .from(schema.employment)
      .where(
        and(
          eq(schema.employment.id, employmentId),
          eq(schema.employment.organizationId, batch.organizationId),
        ),
      )
      .limit(1);
    if (target === undefined) throw notFound('That current job does not exist.');
    await lockPersonRow(batch, target.personId);
    const [row] = await lockJobs(batch, eq(schema.employment.id, employmentId));
    if (row === undefined || !row.employment.isCurrent) {
      throw notFound('That current job does not exist.');
    }
    const employment = await endIn(batch, row.employment, row.companyName);
    await reannounceEmploymentChangeIn(batch, employment.personId, {
      employment,
      personChanged: true,
      leadsChanged: true,
    });
    return { employment };
  });
}
