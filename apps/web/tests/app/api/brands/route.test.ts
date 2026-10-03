import { beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { POST } from '@/app/api/brands/route.ts';
import { signedInAs } from '../../../../tests-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

function create(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost:3300/api/brands', { method: 'POST', body: JSON.stringify(body) }),
  );
}

describe('/api/brands', () => {
  test('an admin creates a brand with its default pipeline', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await create({ name: 'Yodu', color: 'violet' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect([body.brand.color, body.pipeline.key, body.stages.length]).toEqual([
      'violet',
      'YOD',
      13,
    ]);
  });

  test('a guest is refused with the permission named', async () => {
    const guest = await addMember(workspace, 'Gus', 'guest');
    await signedInAs(guest.userId, workspace.organizationId);
    const response = await create({ name: 'Nope' });
    expect(response.status).toBe(403);
    expect((await response.json()).error.details).toEqual({
      permission: 'pipeline:manage',
      role: 'guest',
    });
  });

  test('a write is refused while the workspace is being deleted', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, workspace.organizationId));
    const response = await create({ name: 'Late' });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe('Workspace deletion is in progress.');
  });
});
