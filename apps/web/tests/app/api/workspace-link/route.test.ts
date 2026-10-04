import { beforeEach, describe, expect, test } from 'bun:test';
import { createWorkspace, resetDatabase, type TestWorkspace } from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { GET } from '@/app/api/workspace-link/route.ts';
import { signedInAs, signedOut } from '../../../../tests-support.ts';

const ORIGIN = 'http://localhost:3300';

let workspace: TestWorkspace;
let other: TestWorkspace;
let otherSlug = '';

async function slugOf(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  return row?.slug ?? '';
}

async function activeOf(userId: string): Promise<(string | null)[]> {
  const rows = await db
    .select({ active: schema.session.activeOrganizationId })
    .from(schema.session)
    .where(eq(schema.session.userId, userId));
  return rows.map((row) => row.active);
}

async function redirectOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error: unknown) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return digest.split(';')[2] ?? '';
    }
    throw error;
  }
  throw new Error('Expected the route to redirect.');
}

function open(query: Record<string, string>): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/workspace-link?${new URLSearchParams(query).toString()}`));
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Home');
  other = await createWorkspace('Away');
  otherSlug = await slugOf(other.organizationId);
});

describe('/api/workspace-link', () => {
  test('switches to a workspace the user belongs to and continues to the link', async () => {
    const { createOrganization } = await import('@gravity/core');
    const second = await createOrganization(workspace.adminUser.id, {
      name: 'Second',
      slug: `second-${workspace.organizationId.slice(-8)}`,
    });
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const slug = await slugOf(second.organization.id);
    const next = `/l/SEC-1?w=${slug}`;
    expect(await redirectOf(open({ w: slug.toUpperCase(), next }))).toBe(next);
    expect(await activeOf(workspace.adminUser.id)).toContain(second.organization.id);
  });

  test('a workspace the user is not in is not found and nothing switches', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await open({ w: otherSlug, next: '/leads' });
    expect(response.status).toBe(404);
    expect(await activeOf(workspace.adminUser.id)).toEqual([workspace.organizationId]);
  });

  test('never continues to another origin', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const own = await slugOf(workspace.organizationId);
    for (const next of ['https://evil.example/', '//evil.example/x', '/\\evil.example']) {
      expect(await redirectOf(open({ w: own, next }))).toBe('/today');
    }
  });

  test('a signed out visitor is sent to sign in with the link kept', async () => {
    signedOut();
    const location = await redirectOf(open({ w: otherSlug, next: '/people/p1' }));
    expect(location).toBe('/login?next=%2Fpeople%2Fp1');
  });
});
