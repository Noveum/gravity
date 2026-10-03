import { and, asc, eq, inArray, isNull, schema } from '@gravity/db';
import type { EmploymentRow, PersonRow } from '@gravity/shared/records';
import { leadRowById } from './lead-rows.ts';
import { selectPersonRows } from './person-lookup.ts';
import { employmentRowOf } from './rows.ts';
import { employmentScopes, leadScopes, personScopes } from './scopes.ts';
import type { SyncBatch } from './sync-batch.ts';

export function emitPerson(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update',
  person: PersonRow,
): void {
  batch.emit({
    syncId,
    action,
    model: 'person',
    modelId: person.id,
    data: person,
    scopes: personScopes(batch.organizationId, person.id),
  });
}

export function emitEmployment(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update',
  employment: EmploymentRow,
): void {
  batch.emit({
    syncId,
    action,
    model: 'employment',
    modelId: employment.id,
    data: employment,
    scopes: employmentScopes(batch.organizationId, employment.personId, employment.companyId),
  });
}

export async function peopleCurrentlyAt(batch: SyncBatch, companyId: string): Promise<string[]> {
  const rows = await batch.tx
    .selectDistinct({ personId: schema.employment.personId })
    .from(schema.employment)
    .where(
      and(
        eq(schema.employment.organizationId, batch.organizationId),
        eq(schema.employment.companyId, companyId),
        eq(schema.employment.isCurrent, true),
      ),
    )
    .orderBy(asc(schema.employment.personId));
  return rows.map((row) => row.personId);
}

export async function reannouncePeopleIn(
  batch: SyncBatch,
  personIds: readonly string[],
): Promise<PersonRow[]> {
  const people = [...new Set(personIds)];
  if (people.length === 0) return [];
  const locked = await batch.tx
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(
      and(
        eq(schema.person.organizationId, batch.organizationId),
        inArray(schema.person.id, people),
        isNull(schema.person.archivedAt),
      ),
    )
    .orderBy(asc(schema.person.id))
    .for('update');
  const announced: PersonRow[] = [];
  for (const { id } of locked) {
    const syncId = await batch.nextSyncId();
    await batch.tx.update(schema.person).set({ syncId }).where(eq(schema.person.id, id));
    const [person] = await selectPersonRows(
      batch.tx,
      batch.organizationId,
      eq(schema.person.id, id),
      {
        limit: 1,
      },
    );
    if (person === undefined) continue;
    emitPerson(batch, syncId, 'update', person);
    announced.push(person);
  }
  return announced;
}

export async function reannounceLeadsOfPeopleIn(
  batch: SyncBatch,
  personIds: readonly string[],
): Promise<void> {
  const people = [...new Set(personIds)];
  if (people.length === 0) return;
  const locked = await batch.tx
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, batch.organizationId),
        inArray(schema.lead.personId, people),
        isNull(schema.lead.archivedAt),
      ),
    )
    .orderBy(asc(schema.lead.id))
    .for('update');
  for (const { id } of locked) {
    const syncId = await batch.nextSyncId();
    await batch.tx.update(schema.lead).set({ syncId }).where(eq(schema.lead.id, id));
    const lead = await leadRowById(batch.tx, batch.organizationId, id);
    batch.emit({
      syncId,
      action: 'update',
      model: 'lead',
      modelId: lead.id,
      data: lead,
      scopes: leadScopes(batch.organizationId, lead),
    });
  }
}

export async function reannounceEmploymentsAtIn(
  batch: SyncBatch,
  companyId: string,
  companyName: string,
): Promise<void> {
  const locked = await batch.tx
    .select({ id: schema.employment.id })
    .from(schema.employment)
    .where(
      and(
        eq(schema.employment.organizationId, batch.organizationId),
        eq(schema.employment.companyId, companyId),
      ),
    )
    .orderBy(asc(schema.employment.id))
    .for('update');
  for (const { id } of locked) {
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.employment)
      .set({ syncId })
      .where(eq(schema.employment.id, id))
      .returning();
    if (row === undefined) continue;
    emitEmployment(batch, syncId, 'update', employmentRowOf(row, companyName));
  }
}
