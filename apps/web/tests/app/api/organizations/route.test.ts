import { beforeEach, describe, expect, test } from 'bun:test';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { POST as switchWorkspace } from '@/app/api/organizations/active/route.ts';
import { GET, POST } from '@/app/api/organizations/route.ts';
import { signedInAs } from '../../../../tests-support.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('/api/organizations', () => {
  test('creates a workspace for the signed in user and lists it', async () => {
    const user = await createUser('Ada');
    await signedInAs(user.id);
    const created = await POST(
      new Request('http://localhost:3300/api/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
      }),
    );
    expect(created.status).toBe(200);
    const listed = await (await GET(new Request('http://localhost:3300/api/organizations'))).json();
    expect(listed.organizations.map((row: { slug: string }) => row.slug)).toEqual(['acme']);
    expect(await db.select().from(schema.outbox)).not.toHaveLength(0);
  });

  test('rejects an anonymous request', async () => {
    const response = await POST(
      new Request('http://localhost:3300/api/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe('/api/organizations/active', () => {
  function switchRequest(organizationId: string): Request {
    return new Request('http://localhost:3300/api/organizations/active', {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    });
  }

  test('switches to another workspace the user belongs to', async () => {
    const first = await createWorkspace('First');
    await signedInAs(first.adminUser.id, first.organizationId);
    const created = await POST(
      new Request('http://localhost:3300/api/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Second', slug: 'second-space' }),
      }),
    );
    const { organization } = (await created.json()) as { organization: { id: string } };
    const back = await switchWorkspace(switchRequest(first.organizationId));
    expect(back.status).toBe(200);
    const [session] = await db.select().from(schema.session);
    expect(session?.activeOrganizationId).toBe(first.organizationId);
    const forward = await switchWorkspace(switchRequest(organization.id));
    expect(forward.status).toBe(200);
    const [after] = await db.select().from(schema.session);
    expect(after?.activeOrganizationId).toBe(organization.id);
  });

  test('refuses a workspace the user does not belong to', async () => {
    const mine = await createWorkspace('Mine');
    const theirs = await createWorkspace('Theirs');
    await signedInAs(mine.adminUser.id, mine.organizationId);
    const response = await switchWorkspace(switchRequest(theirs.organizationId));
    expect(response.status).toBe(403);
    const [session] = await db.select().from(schema.session);
    expect(session?.activeOrganizationId).toBe(mine.organizationId);
  });

  test('rejects an anonymous request', async () => {
    const response = await switchWorkspace(switchRequest('anything'));
    expect(response.status).toBe(401);
  });
});
