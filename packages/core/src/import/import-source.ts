import { and, eq, isNull, schema } from '@gravity/db';
import type { Executor } from '../internal.ts';

export async function sourceLinkedPersonId(
  executor: Executor,
  organizationId: string,
  source: string,
  sourceId: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ personId: schema.importSource.personId })
    .from(schema.importSource)
    .innerJoin(
      schema.person,
      and(
        eq(schema.person.id, schema.importSource.personId),
        eq(schema.person.organizationId, schema.importSource.organizationId),
      ),
    )
    .where(
      and(
        eq(schema.importSource.organizationId, organizationId),
        eq(schema.importSource.source, source),
        eq(schema.importSource.sourceId, sourceId),
        isNull(schema.person.archivedAt),
      ),
    )
    .limit(1);
  return row?.personId ?? null;
}

export async function linkImportSource(
  executor: Executor,
  organizationId: string,
  source: string,
  sourceId: string,
  personId: string,
): Promise<void> {
  await executor
    .insert(schema.importSource)
    .values({ organizationId, source, sourceId, personId })
    .onConflictDoUpdate({
      target: [
        schema.importSource.organizationId,
        schema.importSource.source,
        schema.importSource.sourceId,
      ],
      set: { personId, updatedAt: new Date() },
    });
}
