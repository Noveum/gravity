import { beforeEach, describe, expect, test } from 'bun:test';
import { createBrand, createLead, upsertPerson } from '@gravity/core';
import { createWorkspace, resetDatabase, type TestWorkspace } from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { encodeFilter, inCondition } from '@gravity/shared/filters';
import { GET as getLead, PATCH } from '@/app/api/leads/[id]/route.ts';
import { GET as getLeadByKey } from '@/app/api/leads/key/[key]/route.ts';
import { POST as quickCreate } from '@/app/api/leads/quick/route.ts';
import { GET, POST } from '@/app/api/leads/route.ts';
import { leadPageSchema } from '@/lib/query/schemas.ts';
import { signedInAs } from '../../../../tests-support.ts';

let workspace: TestWorkspace;
let pipelineId = '';
let readyId = '';
let personId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  pipelineId = brand.pipeline.id;
  readyId = brand.stages.find((stage) => stage.name === 'Ready')?.id ?? '';
  personId = (
    await upsertPerson(
      { principal: workspace.admin },
      { name: 'Ada Lovelace', emails: ['ada@acme.io'] },
    )
  ).person.id;
  await signedInAs(workspace.adminUser.id, workspace.organizationId);
});

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

function byKey(key: string): Promise<Response> {
  return getLeadByKey(new Request(`http://localhost:3300/api/leads/key/${key}`), {
    params: Promise.resolve({ key }),
  });
}

describe('/api/leads', () => {
  test('creating a lead carries the client id into the outbox', async () => {
    await db.delete(schema.outbox);
    const response = await POST(
      post(
        'http://localhost:3300/api/leads',
        { personId, pipelineId },
        { 'x-gravity-client-id': 'tab-1' },
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).lead.key).toBe('YOD-1');
    const payloads = (await db.select().from(schema.outbox)).map((row) => row.payload);
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.every((payload) => payload['originClientId'] === 'tab-1')).toBe(true);
  });

  test('lists with the URL filter and refuses an unknown property with 422', async () => {
    await createLead({ principal: workspace.admin }, { personId, pipelineId, stageId: readyId });
    const filter = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [inCondition('stage', [readyId])],
    });
    const listed = await GET(
      new Request(
        `http://localhost:3300/api/leads?pipelineId=${pipelineId}&filter=${encodeURIComponent(filter)}`,
      ),
    );
    expect(leadPageSchema.parse(await listed.json()).leads.map((lead) => lead.key)).toEqual([
      'YOD-1',
    ]);
    const bad = encodeFilter({
      kind: 'group',
      combinator: 'and',
      children: [inCondition('ghost', ['x'])],
    });
    const refused = await GET(
      new Request(
        `http://localhost:3300/api/leads?pipelineId=${pipelineId}&filter=${encodeURIComponent(bad)}`,
      ),
    );
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.message).toBe('There is no lead filter called ghost.');
  });

  test('changes a lead and hides another workspace lead behind 404', async () => {
    const { lead } = await createLead({ principal: workspace.admin }, { personId, pipelineId });
    const context = { params: Promise.resolve({ id: lead.id }) };
    const patched = await PATCH(
      new Request(`http://localhost:3300/api/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ type: 'update', patch: { stageId: readyId } }),
      }),
      context,
    );
    expect((await patched.json()).lead.stageId).toBe(readyId);
    const other = await createWorkspace('Other');
    await signedInAs(other.adminUser.id, other.organizationId);
    expect(
      (await getLead(new Request(`http://localhost:3300/api/leads/${lead.id}`), context)).status,
    ).toBe(404);
  });

  test('quick create refuses a duplicate open lead with the existing key in the details', async () => {
    const body = { pipelineId, person: { name: 'Ada', emails: ['ada@acme.io'] } };
    expect((await quickCreate(post('http://localhost:3300/api/leads/quick', body))).status).toBe(
      200,
    );
    const refused = await quickCreate(post('http://localhost:3300/api/leads/quick', body));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.details.key).toBe('YOD-1');
  });

  test('reads a lead by its key and answers 404 for a malformed key', async () => {
    await createLead({ principal: workspace.admin }, { personId, pipelineId });
    const found = await byKey('YOD-1');
    expect(found.status).toBe(200);
    expect((await found.json()).lead.key).toBe('YOD-1');
    expect((await byKey('%E0%A4%A')).status).toBe(404);
  });
});
