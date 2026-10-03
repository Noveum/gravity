import { db, schema } from '@gravity/db';
import type { SyncAction } from '@gravity/shared/events';
import { createBrand } from '../../src/crm/brand-service.ts';
import type { TestWorkspace } from '../../src/test-support.ts';

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}.`);
  return value;
}

export async function openLeadFor(workspace: TestWorkspace, personId: string): Promise<string> {
  const created = await createBrand({ principal: workspace.admin }, { name: `Brand ${personId}` });
  const stage = required(created.stages[0], 'a stage in the new brand');
  const id = `lead-${personId}`;
  await db.insert(schema.lead).values({
    id,
    organizationId: workspace.organizationId,
    personId,
    pipelineId: created.pipeline.id,
    number: 1,
    stageId: stage.id,
    stageCategory: stage.category,
  });
  return id;
}

export function emitted(actions: readonly SyncAction[], model: string): SyncAction[] {
  return actions.filter((action) => action.model === model);
}

export function modelCounts(actions: readonly SyncAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) counts[action.model] = (counts[action.model] ?? 0) + 1;
  return counts;
}
