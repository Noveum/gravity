import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { DomainError } from '@gravity/shared/errors';
import { archiveBrand, createBrand, listBrands } from '../../src/crm/brand-service.ts';
import { listPipelines } from '../../src/crm/pipeline-service.ts';
import { acceptInvite, createInvite } from '../../src/org/invite-service.ts';
import { resolvePrincipal } from '../../src/org/member-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  createUser,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

describe('createBrand', () => {
  test('creates the brand, playbook v1 and a prospecting pipeline with the default stages', async () => {
    const created = await createBrand(
      { principal: workspace.admin, originClientId: 'tab-1' },
      { name: 'Yodu', color: 'green' },
    );
    expect(created.brand).toMatchObject({
      name: 'Yodu',
      color: 'green',
      currentPlaybookVersion: 1,
    });
    expect(created.pipeline).toMatchObject({ key: 'YOD', name: 'Prospecting', kind: 'people' });
    expect(created.stages.map((stage) => stage.name)).toHaveLength(13);
    expect(created.stages.map((stage) => stage.sortOrder)).toEqual([...new Array(13).keys()]);
    const playbooks = await db
      .select()
      .from(schema.playbookVersion)
      .where(eq(schema.playbookVersion.brandId, created.brand.id));
    expect(playbooks.map((row) => row.version)).toEqual([1]);
    expect(created.actions.map((action) => action.model)).toEqual([
      'brand',
      'pipeline',
      ...new Array(13).fill('stage'),
    ]);
    expect(created.actions.every((action) => action.originClientId === 'tab-1')).toBe(true);
    expect(created.actions[1]?.scopes).toEqual([
      `workspace:${workspace.organizationId}`,
      `brand:${created.brand.id}`,
      `pipeline:${created.pipeline.id}`,
    ]);
  });

  test('walks past a taken key and refuses an explicit duplicate', async () => {
    await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const second = await createBrand({ principal: workspace.admin }, { name: 'Yolanda' });
    expect(second.pipeline.key).toBe('YOL');
    const third = await createBrand({ principal: workspace.admin }, { name: 'Yod' });
    expect(third.pipeline.key).toBe('YOA');
    await expect(
      createBrand({ principal: workspace.admin }, { name: 'Other', pipelineKey: 'yod' }),
    ).rejects.toThrow('Another pipeline already uses that key.');
  });

  test('a guest cannot create a brand', async () => {
    const guestUser = await createUser('Gus');
    const { token } = await createInvite(workspace.admin, {
      email: guestUser.email,
      role: 'guest',
    });
    await acceptInvite(token, guestUser.id);
    const guest = await resolvePrincipal(guestUser.id, workspace.organizationId);
    const attempt = createBrand({ principal: guest }, { name: 'Nope' });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    expect(await listBrands(workspace.admin)).toHaveLength(0);
  });
});

describe('archiveBrand', () => {
  test('archives the brand and its pipelines and hides both from lists', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const archived = await archiveBrand({ principal: workspace.admin }, created.brand.id);
    expect(archived.actions.map((action) => [action.model, action.action])).toEqual([
      ['brand', 'archive'],
      ['pipeline', 'archive'],
    ]);
    expect(await listBrands(workspace.admin)).toHaveLength(0);
    expect(await listPipelines(workspace.admin)).toHaveLength(0);
  });

  test('another workspace cannot see or archive the brand', async () => {
    const created = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    const other = await createWorkspace('Other');
    await expect(archiveBrand({ principal: other.admin }, created.brand.id)).rejects.toThrow(
      'That brand does not exist.',
    );
    expect(await listBrands(other.admin)).toHaveLength(0);
  });
});
