import { beforeEach, describe, expect, test } from 'bun:test';
import { consumeRequestRateLimit, createBrand } from '@gravity/core';
import {
  createMemberPrincipal,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { POST } from '@/app/api/imports/route.ts';
import { IMPORT_COMMIT_RATE, importRateKey, MAX_IMPORT_REQUEST_BYTES } from '@/lib/api/imports.ts';
import { signedInAs } from '../../../../tests-support.ts';

let workspace: TestWorkspace;
let pipelineId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  pipelineId = (
    await createBrand({ principal: workspace.admin }, { name: 'Lumen', pipelineKey: 'LUM' })
  ).pipeline.id;
  await signedInAs(workspace.adminUser.id, workspace.organizationId);
  await db.delete(schema.outbox);
});

function commit(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost:3300/api/imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

const BODY = {
  format: 'csv',
  content: 'Name,Email\nAda Lovelace,ada@vela.example\nGrace Hopper,grace@quarry.example\n',
  target: 'leads',
  mapping: { Name: 'person.name', Email: 'person.email' },
};

describe('/api/imports', () => {
  test('commits the rows as the import and carries the client id into the outbox', async () => {
    const response = await commit({ ...BODY, pipelineId }, { 'x-gravity-client-id': 'tab-9' });
    expect(response.status).toBe(200);
    const { report } = (await response.json()) as {
      report: { status: string; rows: { leadKey: string | null }[] };
    };
    expect(report.status).toBe('completed');
    expect(report.rows.map((row) => row.leadKey)).toEqual(['LUM-1', 'LUM-2']);
    const payloads = (await db.select().from(schema.outbox)).map((row) => row.payload);
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.every((payload) => payload['originClientId'] === 'tab-9')).toBe(true);
    expect(
      payloads.every((payload) => (payload['actor'] as { type?: string }).type === 'integration'),
    ).toBe(true);
  });

  test('refuses a commit once the hourly budget is spent', async () => {
    for (let index = 0; index < IMPORT_COMMIT_RATE.max; index += 1) {
      await consumeRequestRateLimit(importRateKey('commit', workspace.admin), IMPORT_COMMIT_RATE);
    }
    const response = await commit({ ...BODY, pipelineId });
    expect(response.status).toBe(429);
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('the budget is per user and workspace, so a teammate keeps theirs', async () => {
    for (let index = 0; index < IMPORT_COMMIT_RATE.max; index += 1) {
      await consumeRequestRateLimit(importRateKey('commit', workspace.admin), IMPORT_COMMIT_RATE);
    }
    const member = await createMemberPrincipal(workspace, 'member');
    await signedInAs(member.userId, workspace.organizationId);
    expect((await commit({ ...BODY, pipelineId })).status).toBe(200);
  });

  test('refuses a body over the cap with 413 and writes nothing', async () => {
    const response = await commit('x'.repeat(MAX_IMPORT_REQUEST_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('refuses a role without import rights and writes nothing', async () => {
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    await signedInAs(contributor.userId, workspace.organizationId);
    expect((await commit({ ...BODY, pipelineId })).status).toBe(403);
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });
});
