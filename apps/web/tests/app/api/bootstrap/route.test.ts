import { beforeEach, describe, expect, test } from 'bun:test';
import {
  archiveStage,
  createBrand,
  createSavedView,
  removeMember,
  saveViewPreference,
  updateSavedView,
} from '@gravity/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { GET } from '@/app/api/bootstrap/route.ts';
import { bootstrapSchema } from '@/lib/query/schemas.ts';
import { signedInAs } from '../../../../tests-support.ts';

let workspace: TestWorkspace;

function fetchBootstrap(etag?: string): Promise<Response> {
  return GET(
    new Request(
      'http://localhost:3300/api/bootstrap',
      etag === undefined ? {} : { headers: { 'if-none-match': etag } },
    ),
  );
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

describe('/api/bootstrap', () => {
  test('returns brands, pipelines, stages and members in the wire shape', async () => {
    await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await fetchBootstrap();
    expect(response.status).toBe(200);
    const body = bootstrapSchema.parse(await response.json());
    expect(body.pipelines.map((pipeline) => pipeline.key)).toEqual(['YOD']);
    expect(body.stages).toHaveLength(13);
    expect(body.members.map((member) => member.userId)).toEqual([workspace.adminUser.id]);
    expect(body.me).toEqual({ userId: workspace.adminUser.id, role: 'admin' });
  });

  test('answers 304 while nothing changed and a new ETag after a stage is archived', async () => {
    const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const etag = (await fetchBootstrap()).headers.get('etag') ?? '';
    expect((await fetchBootstrap(etag)).status).toBe(304);
    const lastOpen = brand.stages.find((stage) => stage.name === 'Meeting held')?.id ?? '';
    await archiveStage({ principal: workspace.admin }, lastOpen);
    const after = await fetchBootstrap(etag);
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(etag);
  });

  test('a new ETag after a member is removed', async () => {
    const teammate = await addMember(workspace, 'Tess', 'member');
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const etag = (await fetchBootstrap()).headers.get('etag') ?? '';
    const [row] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, teammate.userId));
    await removeMember(workspace.admin, row?.id ?? '');
    expect((await fetchBootstrap(etag)).status).toBe(200);
  });

  test('a new ETag after a member changes their email', async () => {
    const teammate = await addMember(workspace, 'Tess', 'member');
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const etag = (await fetchBootstrap()).headers.get('etag') ?? '';
    await db
      .update(schema.user)
      .set({ email: 'tess.new@example.com' })
      .where(eq(schema.user.id, teammate.userId));
    const after = await fetchBootstrap(etag);
    expect(after.status).toBe(200);
    const emails = bootstrapSchema.parse(await after.json()).members.map((member) => member.email);
    expect(emails).toContain('tess.new@example.com');
  });

  test('a teammate gets a new ETag when a shared view is narrowed away from them', async () => {
    const teammate = await addMember(workspace, 'Tess', 'member');
    const shared = await createSavedView(
      { principal: workspace.admin },
      { object: 'person', name: 'Team', visibility: 'workspace' },
    );
    await signedInAs(teammate.userId, workspace.organizationId);
    const first = await fetchBootstrap();
    expect(bootstrapSchema.parse(await first.json()).savedViews).toHaveLength(1);
    await updateSavedView({ principal: workspace.admin }, shared.view.id, {
      visibility: 'private',
    });
    const after = await fetchBootstrap(first.headers.get('etag') ?? '');
    expect(after.status).toBe(200);
    expect(bootstrapSchema.parse(await after.json()).savedViews).toHaveLength(0);
  });

  test('a new ETag each time the viewer saves a different view preference', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const first = (await fetchBootstrap()).headers.get('etag') ?? '';
    await saveViewPreference(workspace.admin, { page: 'leads', layout: 'board' });
    const second = await fetchBootstrap(first);
    expect(second.status).toBe(200);
    await saveViewPreference(workspace.admin, { page: 'leads', layout: 'list' });
    const third = await fetchBootstrap(second.headers.get('etag') ?? '');
    expect(third.status).toBe(200);
    expect(
      bootstrapSchema.parse(await third.json()).viewPreferences.map((row) => row.layout),
    ).toEqual(['list']);
  });

  test('still answers while the workspace is being deleted', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, workspace.organizationId));
    expect((await fetchBootstrap()).status).toBe(200);
  });
});
