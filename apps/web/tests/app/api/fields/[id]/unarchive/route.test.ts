import { beforeEach, describe, expect, test } from 'bun:test';
import { archiveFieldDefinition, createFieldDefinition } from '@gravity/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { POST } from '@/app/api/fields/[id]/unarchive/route.ts';
import { signedInAs } from '../../../../../../tests-support.ts';

let workspace: TestWorkspace;
let fieldId = '';
const spec = { object: 'lead', key: 'seats', label: 'Seats', type: 'number' } as const;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const { field } = await createFieldDefinition({ principal: workspace.admin }, spec);
  fieldId = field.id;
  await archiveFieldDefinition({ principal: workspace.admin }, fieldId);
});

function unarchive(id: string): Promise<Response> {
  return POST(new Request(`http://localhost:3300/api/fields/${id}/unarchive`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

describe('/api/fields/[id]/unarchive', () => {
  test('an admin restores a field', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await unarchive(fieldId);
    expect(response.status).toBe(200);
    expect((await response.json()).field).toMatchObject({ id: fieldId, archivedAt: null });
  });

  test('a reused key is a 409 with the server message', async () => {
    await createFieldDefinition({ principal: workspace.admin }, { ...spec, label: 'Seats again' });
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await unarchive(fieldId);
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(
      'A custom field with that key already exists here.',
    );
  });

  test('a guest is refused with the permission named', async () => {
    const guest = await addMember(workspace, 'Gus', 'guest');
    await signedInAs(guest.userId, workspace.organizationId);
    const response = await unarchive(fieldId);
    expect(response.status).toBe(403);
    expect((await response.json()).error.details).toEqual({
      permission: 'field:manage',
      role: 'guest',
    });
  });
});
