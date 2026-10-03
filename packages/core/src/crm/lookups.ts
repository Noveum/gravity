import { and, asc, eq, inArray, isNull, schema } from '@gravity/db';
import { notFound, validationFailed } from '@gravity/shared/errors';
import type { StageRow } from '@gravity/shared/records';
import type { Executor } from '../internal.ts';
import { stageRowOf } from './rows.ts';

export async function liveBrand(executor: Executor, organizationId: string, brandId: string) {
  const [row] = await executor
    .select()
    .from(schema.brand)
    .where(
      and(
        eq(schema.brand.id, brandId),
        eq(schema.brand.organizationId, organizationId),
        isNull(schema.brand.archivedAt),
      ),
    )
    .limit(1);
  if (row === undefined) throw notFound('That brand does not exist.');
  return row;
}

export async function livePipeline(
  executor: Executor,
  organizationId: string,
  pipelineId: string,
  lock = false,
) {
  const query = executor
    .select()
    .from(schema.pipeline)
    .where(
      and(
        eq(schema.pipeline.id, pipelineId),
        eq(schema.pipeline.organizationId, organizationId),
        isNull(schema.pipeline.archivedAt),
      ),
    )
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) throw notFound('That pipeline does not exist.');
  return row;
}

export async function liveStagesOf(
  executor: Executor,
  organizationId: string,
  pipelineIds: readonly string[],
): Promise<StageRow[]> {
  if (pipelineIds.length === 0) return [];
  const rows = await executor
    .select()
    .from(schema.stage)
    .where(
      and(
        eq(schema.stage.organizationId, organizationId),
        inArray(schema.stage.pipelineId, [...pipelineIds]),
        isNull(schema.stage.archivedAt),
      ),
    )
    .orderBy(asc(schema.stage.sortOrder));
  return rows.map(stageRowOf);
}

export async function assertMember(
  executor: Executor,
  organizationId: string,
  userId: string,
): Promise<void> {
  const [row] = await executor
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (row === undefined) throw validationFailed('That owner is not a member of this workspace.');
}

export async function takenPipelineKeys(
  executor: Executor,
  organizationId: string,
): Promise<Set<string>> {
  const rows = await executor
    .select({ key: schema.pipeline.key })
    .from(schema.pipeline)
    .where(
      and(eq(schema.pipeline.organizationId, organizationId), isNull(schema.pipeline.archivedAt)),
    );
  return new Set(rows.map((row) => row.key));
}
