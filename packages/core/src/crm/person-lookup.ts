import { and, asc, eq, isNull, type SQL, schema } from '@gravity/db';
import { notFound } from '@gravity/shared/errors';
import type { PersonRow } from '@gravity/shared/records';
import { type Executor, requireRow } from '../internal.ts';
import { currentCompanyId, currentCompanyName, currentTitle } from './current-company.ts';
import { personRowOf } from './rows.ts';

export interface PersonQueryOptions {
  readonly orderBy?: readonly SQL[];
  readonly limit?: number;
}

export async function livePerson(
  executor: Executor,
  organizationId: string,
  personId: string,
  lock: 'update' | 'share' | false = false,
) {
  const query = executor
    .select()
    .from(schema.person)
    .where(
      and(
        eq(schema.person.id, personId),
        eq(schema.person.organizationId, organizationId),
        isNull(schema.person.archivedAt),
      ),
    )
    .limit(1);
  const [row] = lock === false ? await query : await query.for(lock);
  if (row === undefined) throw notFound('That person does not exist.');
  return row;
}

export async function selectPersonRows(
  executor: Executor,
  organizationId: string,
  where: SQL | undefined,
  options: PersonQueryOptions = {},
): Promise<PersonRow[]> {
  const query = executor
    .select({
      person: schema.person,
      companyId: currentCompanyId(schema.person.id),
      companyName: currentCompanyName(schema.person.id),
      title: currentTitle(schema.person.id),
    })
    .from(schema.person)
    .where(and(eq(schema.person.organizationId, organizationId), where))
    .orderBy(...(options.orderBy ?? [asc(schema.person.name), asc(schema.person.id)]));
  const rows = options.limit === undefined ? await query : await query.limit(options.limit);
  return rows.map((row) => personRowOf(row.person, row));
}

export async function personRowById(
  executor: Executor,
  organizationId: string,
  personId: string,
): Promise<PersonRow> {
  const [row] = await selectPersonRows(
    executor,
    organizationId,
    and(eq(schema.person.id, personId), isNull(schema.person.archivedAt)),
    { limit: 1 },
  );
  return requireRow(row, 'That person does not exist.');
}
