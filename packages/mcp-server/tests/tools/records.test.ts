import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  closeRealtime,
  createBrand,
  createLead,
  createOrganization,
  createSavedView,
  resolvePrincipal,
  upsertPerson,
} from '@gravity/core';
import {
  addMember,
  createWorkspace,
  mintMcpToken,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { CONTEXT_TOKENS } from '@gravity/shared/constants';
import { connect, type TestClient } from '../../src/test-helpers.ts';

let workspace: TestWorkspace;
let client: TestClient;
let otherWorkspaceId = '';
let otherPersonId = '';
let readyId = '';
let personId = '';
let privateViewId = '';
let teammateViewId = '';

const READY_FILTER = () => ({
  kind: 'group',
  combinator: 'and',
  children: [{ kind: 'condition', property: 'stage', operator: 'in', values: [readyId] }],
});

function keysOf(data: Record<string, unknown>): string[] {
  return (data['leads'] as { key: string }[]).map((lead) => lead.key);
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nimbus');
  const context = { principal: workspace.admin };
  const brand = await createBrand(context, { name: 'Lumen', pipelineKey: 'LUM' });
  readyId = brand.stages.find((stage) => stage.name === 'Ready')?.id ?? '';
  const ada = await upsertPerson(context, {
    name: 'Ada Lovelace',
    emails: ['ada@vela.example'],
    company: { domain: 'vela.example', name: 'Vela Robotics' },
  });
  personId = ada.person.id;
  const grace = await upsertPerson(context, {
    name: 'Grace Hopper',
    emails: ['grace@quarry.example'],
  });
  await createLead(context, { personId, pipelineId: brand.pipeline.id });
  await createLead(context, {
    personId: grace.person.id,
    pipelineId: brand.pipeline.id,
    stageId: readyId,
  });
  await createSavedView(context, {
    object: 'lead',
    pipelineId: brand.pipeline.id,
    name: 'Ready ones',
    visibility: 'workspace',
    filter: READY_FILTER(),
  });
  privateViewId = (
    await createSavedView(context, {
      object: 'lead',
      pipelineId: brand.pipeline.id,
      name: 'Mine only',
      visibility: 'private',
      filter: READY_FILTER(),
    })
  ).view.id;
  const teammate = await addMember(workspace, 'Tess Teammate', 'member');
  teammateViewId = (
    await createSavedView(
      { principal: teammate },
      {
        object: 'lead',
        pipelineId: brand.pipeline.id,
        name: 'Tess secret',
        visibility: 'private',
        filter: READY_FILTER(),
      },
    )
  ).view.id;
  const harbor = await createBrand(context, { name: 'Harbor', pipelineKey: 'HAR' });
  await createSavedView(context, {
    object: 'lead',
    pipelineId: harbor.pipeline.id,
    name: 'Harbor view',
    visibility: 'workspace',
  });
  const other = await createOrganization(workspace.adminUser.id, {
    name: 'Elsewhere',
    slug: 'elsewhere-mcp',
  });
  otherWorkspaceId = other.organization.id;
  const elsewhere = await resolvePrincipal(workspace.adminUser.id, otherWorkspaceId);
  await createBrand({ principal: elsewhere }, { name: 'Other', pipelineKey: 'OTH' });
  otherPersonId = (
    await upsertPerson(
      { principal: elsewhere },
      { name: 'Bea Byron', emails: ['bea@other.example'], company: { domain: 'other.example' } },
    )
  ).person.id;
  client = await connect(
    (await mintMcpToken(workspace.organizationId, workspace.adminUser.id)).token,
  );
});

afterAll(async () => {
  await client.close();
  await closeRealtime();
});

describe('tools/list', () => {
  test('a read token lists the four read tools', async () => {
    const { tools } = await client.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'describe_workspace',
      'get_context',
      'list_leads',
      'search',
    ]);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe('search', () => {
  test('finds people, companies and leads with links', async () => {
    const { text, data } = await client.result('search', { query: 'Ada' });
    expect(data['people']).toEqual([
      expect.objectContaining({
        name: 'Ada Lovelace',
        url: `http://localhost:3300/people/${personId}`,
      }),
    ]);
    expect(data['leads']).toEqual([
      expect.objectContaining({ key: 'LUM-1', url: 'http://localhost:3300/l/LUM-1' }),
    ]);
    expect(text).toContain('Ada Lovelace');
    const companies = await client.result('search', { query: 'Vela' });
    expect(companies.data['companies']).toEqual([
      expect.objectContaining({ name: 'Vela Robotics', domain: 'vela.example' }),
    ]);
  });

  test('a lead key finds that lead first', async () => {
    const { data } = await client.result('search', { query: 'LUM-2' });
    expect((data['leads'] as { key: string }[])[0]?.key).toBe('LUM-2');
  });

  test('names the field when the query is empty', async () => {
    const refused = await client.call('search', { query: '  ' });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('query');
  });
});

describe('get_context', () => {
  test('answers for an email, a lead key and a domain', async () => {
    const byEmail = await client.result('get_context', { ref: 'ada@vela.example' });
    expect(byEmail.text).toContain('Person: Ada Lovelace <ada@vela.example>');
    expect(byEmail.data['subject']).toEqual({
      type: 'person',
      id: personId,
      url: `http://localhost:3300/people/${personId}`,
    });
    const byKey = await client.result('get_context', { ref: 'LUM-1' });
    expect(byKey.data['subject']).toMatchObject({
      type: 'lead',
      url: 'http://localhost:3300/l/LUM-1',
    });
    expect(byKey.text).toContain('LUM-1 (in focus)');
    expect(byKey.data['leads']).toEqual([
      expect.objectContaining({ key: 'LUM-1', stage: 'New', owner: 'Ada Admin' }),
    ]);
    const byDomain = await client.result('get_context', { ref: 'vela.example' });
    expect(byDomain.text).toContain('Company: Vela Robotics');
  });

  test('clamps max_tokens into the context budget instead of refusing it', async () => {
    const tiny = await client.result('get_context', { ref: 'ada@vela.example', max_tokens: 1 });
    expect(tiny.text.length).toBeLessThanOrEqual(CONTEXT_TOKENS.min * 4);
    expect(tiny.text).toContain('Person: Ada Lovelace <ada@vela.example>');
    const huge = await client.result('get_context', {
      ref: 'ada@vela.example',
      max_tokens: 1_000_000,
    });
    expect(huge.text).toContain('Person: Ada Lovelace');
    const { tools } = await client.client.listTools();
    const schema = tools.find((tool) => tool.name === 'get_context')?.inputSchema;
    expect(JSON.stringify(schema?.properties?.['max_tokens'])).toContain('8000');
  });

  test('a LinkedIn company URL is not read as the domain linkedin.com', async () => {
    const refused = await client.failure('get_context', {
      ref: 'https://www.linkedin.com/company/vela-robotics',
    });
    expect(refused.code).toBe('not_found');
  });
});

describe('list_leads', () => {
  test('lists a pipeline by key with the filter language, a saved view and paging', async () => {
    const all = await client.result('list_leads', { pipeline: 'lum' });
    expect(keysOf(all.data)).toEqual(['LUM-2', 'LUM-1']);
    expect(all.data['pipeline']).toMatchObject({
      key: 'LUM',
      url: 'http://localhost:3300/leads/LUM',
    });
    const filtered = await client.result('list_leads', { pipeline: 'LUM', filter: READY_FILTER() });
    expect(filtered.data['leads']).toEqual([
      expect.objectContaining({
        person: 'Grace Hopper',
        stage: 'Ready',
        url: 'http://localhost:3300/l/LUM-2',
      }),
    ]);
    const viewed = await client.result('list_leads', { pipeline: 'LUM', view: 'ready ones' });
    expect(keysOf(viewed.data)).toEqual(['LUM-2']);
    const first = await client.result('list_leads', { pipeline: 'LUM', limit: 1 });
    const cursor = first.data['nextCursor'];
    expect(typeof cursor).toBe('string');
    const second = await client.result('list_leads', {
      pipeline: 'LUM',
      limit: 1,
      cursor: String(cursor),
    });
    expect(keysOf(second.data)).toEqual(['LUM-1']);
    expect(second.data['nextCursor']).toBeNull();
  });

  test('a saved view and a filter narrow together, and free text searches', async () => {
    const both = await client.result('list_leads', {
      pipeline: 'LUM',
      view: 'Ready ones',
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [{ kind: 'condition', property: 'person', operator: 'contains', value: 'Ada' }],
      },
    });
    expect(keysOf(both.data)).toEqual([]);
    const searched = await client.result('list_leads', { pipeline: 'LUM', query: 'vela' });
    expect(keysOf(searched.data)).toEqual(['LUM-1']);
  });

  test('reads my private views and workspace views, never a teammate private view', async () => {
    const mine = await client.result('list_leads', { pipeline: 'LUM', view: privateViewId });
    expect(keysOf(mine.data)).toEqual(['LUM-2']);
    const byName = await client.failure('list_leads', { pipeline: 'LUM', view: 'Tess secret' });
    expect(byName.code).toBe('not_found');
    expect(byName.message).toContain('Lead views: Ready ones, Mine only');
    expect(byName.message.split('Lead views:')[1]).not.toContain('Tess');
    const byId = await client.failure('list_leads', { pipeline: 'LUM', view: teammateViewId });
    expect(byId.code).toBe('not_found');
  });

  test('a view of another pipeline is refused with the pipeline it belongs to', async () => {
    const refused = await client.failure('list_leads', { pipeline: 'LUM', view: 'harbor view' });
    expect(refused).toEqual({
      code: 'validation_failed',
      message: 'Harbor view is a view of the HAR pipeline, not LUM.',
    });
  });

  test('names the valid properties and pipelines when the request is wrong', async () => {
    const property = await client.failure('list_leads', {
      pipeline: 'LUM',
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [{ kind: 'condition', property: 'ghost', operator: 'in', values: ['x'] }],
      },
    });
    expect(property.code).toBe('validation_failed');
    expect(property.message).toContain('There is no lead filter called ghost.');
    expect(property.message).toContain('Filter properties: stage, stageCategory, owner');
    const pipeline = await client.failure('list_leads', { pipeline: 'NOPE' });
    expect(pipeline).toEqual({
      code: 'not_found',
      message: 'There is no pipeline NOPE. Pipelines: HAR, LUM.',
    });
  });

  test('refuses keys a filter does not store, as the web app codec does', async () => {
    const stray = await client.failure('list_leads', {
      pipeline: 'LUM',
      filter: { kind: 'group', combinator: 'and', children: [], organizationId: 'elsewhere' },
    });
    expect(stray.code).toBe('validation_failed');
    expect(stray.message).toContain('A filter does not store organizationId');
  });

  test('a bad cursor is refused without a list of filter properties', async () => {
    const refused = await client.failure('list_leads', { pipeline: 'LUM', cursor: 'garbage' });
    expect(refused.code).toBe('validation_failed');
    expect(refused.message).not.toContain('Filter properties');
  });

  test('refuses arguments that name a workspace', async () => {
    const called = await client.call('list_leads', {
      pipeline: 'LUM',
      organizationId: otherWorkspaceId,
    });
    expect(called.isError).toBe(true);
  });
});

describe('workspace boundary', () => {
  test('every tool stays inside the grant workspace, even for a user who belongs to both', async () => {
    expect((await client.result('search', { query: 'Byron' })).data['people']).toEqual([]);
    expect((await client.failure('get_context', { ref: 'bea@other.example' })).code).toBe(
      'not_found',
    );
    expect((await client.failure('get_context', { ref: 'other.example' })).code).toBe('not_found');
    expect((await client.failure('get_context', { ref: otherPersonId })).code).toBe('not_found');
    expect((await client.failure('get_context', { ref: 'OTH-1' })).code).toBe('not_found');
    expect((await client.failure('list_leads', { pipeline: 'OTH' })).code).toBe('not_found');
    const elsewhere = await connect(
      (await mintMcpToken(otherWorkspaceId, workspace.adminUser.id)).token,
    );
    try {
      expect((await elsewhere.result('search', { query: 'Byron' })).data['people']).toEqual([
        expect.objectContaining({ name: 'Bea Byron' }),
      ]);
      expect((await elsewhere.result('search', { query: 'Ada' })).data['people']).toEqual([]);
      expect((await elsewhere.failure('list_leads', { pipeline: 'LUM' })).code).toBe('not_found');
      expect((await elsewhere.failure('get_context', { ref: personId })).code).toBe('not_found');
    } finally {
      await elsewhere.close();
    }
  });

  test('a guest can read', async () => {
    const guest = await addMember(workspace, 'Gus Guest', 'guest');
    const guestClient = await connect(
      (await mintMcpToken(workspace.organizationId, guest.userId, 'gravity.read')).token,
    );
    try {
      expect((await guestClient.result('search', { query: 'Grace' })).data['people']).toHaveLength(
        1,
      );
      expect(keysOf((await guestClient.result('list_leads', { pipeline: 'LUM' })).data)).toEqual([
        'LUM-2',
        'LUM-1',
      ]);
      const context = await guestClient.result('get_context', { ref: 'LUM-2' });
      expect(context.text).toContain('Grace Hopper');
    } finally {
      await guestClient.close();
    }
  });
});
