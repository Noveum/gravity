import { beforeEach, describe, expect, test } from 'bun:test';
import { archiveStage, createBrand } from '@gravity/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { POST } from '@/app/api/stages/[id]/unarchive/route.ts';
import { signedInAs } from '../../../../../../tests-support.ts';

let workspace: TestWorkspace;
let stageId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  stageId = brand.stages.find((stage) => stage.name === 'Follow-up')?.id ?? '';
  await archiveStage({ principal: workspace.admin }, stageId);
});

function unarchive(id: string): Promise<Response> {
  return POST(
    new Request(`http://localhost:3300/api/stages/${id}/unarchive`, {
      method: 'POST',
      headers: { 'x-gravity-client-id': 'tab-1' },
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe('/api/stages/[id]/unarchive', () => {
  test('an admin restores a stage and the outbox row carries the client id', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    await db.delete(schema.outbox);
    const response = await unarchive(stageId);
    expect(response.status).toBe(200);
    expect((await response.json()).stage).toMatchObject({ id: stageId, archivedAt: null });
    const payloads = (await db.select().from(schema.outbox)).map((row) => row.payload);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ action: 'unarchive', originClientId: 'tab-1' });
  });

  test('a guest is refused with the permission named', async () => {
    const guest = await addMember(workspace, 'Gus', 'guest');
    await signedInAs(guest.userId, workspace.organizationId);
    const response = await unarchive(stageId);
    expect(response.status).toBe(403);
    expect((await response.json()).error.details).toEqual({
      permission: 'pipeline:manage',
      role: 'guest',
    });
  });

  test('a stage that is not archived is a 409 and a bad id is a 404', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    expect((await unarchive(stageId)).status).toBe(200);
    const again = await unarchive(stageId);
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toBe('That stage is not archived.');
    expect((await unarchive('not an id!')).status).toBe(404);
  });
});
