import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { archiveBrand, createBrand } from '../../src/crm/brand-service.ts';
import { listCurrentPlaybooks } from '../../src/crm/playbook-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

describe('listCurrentPlaybooks', () => {
  test('returns the current version of each live brand in the workspace only', async () => {
    const live = await createBrand({ principal: workspace.admin }, { name: 'Lumen' });
    const gone = await createBrand({ principal: workspace.admin }, { name: 'Harbor' });
    await archiveBrand({ principal: workspace.admin }, gone.brand.id);
    const other = await createWorkspace('Other');
    await createBrand({ principal: other.admin }, { name: 'Elsewhere' });
    expect(await listCurrentPlaybooks(workspace.admin)).toEqual([
      { brandId: live.brand.id, version: 1, body: '' },
    ]);
  });

  test('returns the body of the version the brand points at, not an older one', async () => {
    const { brand } = await createBrand({ principal: workspace.admin }, { name: 'Lumen' });
    await db.insert(schema.playbookVersion).values({
      id: crypto.randomUUID(),
      organizationId: workspace.organizationId,
      brandId: brand.id,
      version: 2,
      body: 'Lead with the audit.',
    });
    await db
      .update(schema.brand)
      .set({ currentPlaybookVersion: 2 })
      .where(eq(schema.brand.id, brand.id));
    expect(await listCurrentPlaybooks(workspace.admin)).toEqual([
      { brandId: brand.id, version: 2, body: 'Lead with the audit.' },
    ]);
  });
});
