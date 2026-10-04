import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  archiveFieldDefinition,
  closeRealtime,
  createBrand,
  createFieldDefinition,
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
import { db, eq, schema } from '@gravity/db';
import { CONTEXT_TOKENS } from '@gravity/shared/constants';
import { connect, type TestClient } from '../../src/test-helpers.ts';

let workspace: TestWorkspace;
let client: TestClient;
let otherWorkspaceId = '';
let otherPersonId = '';
let otherLeadId = '';
let otherPipelineId = '';
let otherViewId = '';
let readyId = '';
let quillReadyId = '';
let personId = '';
let mainLeadId = '';
let mainPipelineId = '';
let mainViewId = '';
let privateViewId = '';
let teammateViewId = '';

const CROWD_SIZE = 21;

const READY_FILTER = () => ({
  kind: 'group',
  combinator: 'and',
  children: [{ kind: 'condition', property: 'stage', operator: 'in', values: [readyId] }],
});

function stageCondition(stageId: string) {
  return {
    kind: 'condition' as const,
    property: 'stage',
    operator: 'in' as const,
    values: [stageId],
  };
}

function emptyGroup() {
  return { kind: 'group' as const, combinator: 'and' as const, children: [] };
}

async function seedQuill(context: { principal: TestWorkspace['admin'] }, harborId: string) {
  const quill = await createBrand(context, { name: 'Quill', pipelineKey: 'QUI' });
  quillReadyId = quill.stages.find((stage) => stage.name === 'Ready')?.id ?? '';
  await createFieldDefinition(context, {
    object: 'lead',
    pipelineId: harborId,
    key: 'region',
    label: 'Region',
    type: 'text',
  });
  const tier = await createFieldDefinition(context, {
    object: 'lead',
    key: 'tier',
    label: 'Tier',
    type: 'text',
  });
  const nia = await upsertPerson(context, { name: 'Nia\nNorth', emails: ['nia@quill.example'] });
  const otto = await upsertPerson(context, { name: 'Otto Oak', emails: ['otto@quill.example'] });
  await createLead(context, {
    personId: nia.person.id,
    pipelineId: quill.pipeline.id,
    stageId: quillReadyId,
    nextAction: 'Call\nthen\temail',
  });
  await createLead(context, { personId: otto.person.id, pipelineId: quill.pipeline.id });
  const everywhere = await createSavedView(context, {
    object: 'lead',
    pipelineId: null,
    name: 'Everywhere',
    visibility: 'workspace',
  });
  await db
    .update(schema.savedView)
    .set({
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'fields.region',
            operator: 'contains',
            value: 'north',
            negate: false,
          },
        ],
      },
    })
    .where(eq(schema.savedView.id, everywhere.view.id));
  await createSavedView(context, {
    object: 'lead',
    pipelineId: quill.pipeline.id,
    name: 'Gold ready',
    visibility: 'workspace',
    filter: {
      kind: 'group',
      combinator: 'and',
      children: [
        stageCondition(quillReadyId),
        { kind: 'condition', property: 'fields.tier', operator: 'contains', value: 'gold' },
      ],
    },
  });
  await archiveFieldDefinition(context, tier.field.id);
  await createSavedView(context, {
    object: 'lead',
    pipelineId: quill.pipeline.id,
    name: 'Thirty',
    visibility: 'workspace',
    filter: {
      kind: 'group',
      combinator: 'and',
      children: Array.from({ length: 30 }, () => stageCondition(quillReadyId)),
    },
  });
}

async function seedCrowd(context: { principal: TestWorkspace['admin'] }, pipelineId: string) {
  for (let index = 1; index <= CROWD_SIZE; index += 1) {
    const label = String(index).padStart(2, '0');
    const member = await upsertPerson(context, {
      name: `Crowd Person ${label}`,
      emails: [`person${label}@crowd.example`],
      phones: [`+1 555 01${label}`],
      company: { domain: 'crowd.example', name: 'Crowd Co' },
    });
    await createLead(context, { personId: member.person.id, pipelineId });
  }
}

async function seedElsewhere(): Promise<void> {
  const other = await createOrganization(workspace.adminUser.id, {
    name: 'Elsewhere',
    slug: 'elsewhere-mcp',
  });
  otherWorkspaceId = other.organization.id;
  const elsewhere = { principal: await resolvePrincipal(workspace.adminUser.id, otherWorkspaceId) };
  const brand = await createBrand(elsewhere, { name: 'Other', pipelineKey: 'LUM' });
  otherPipelineId = brand.pipeline.id;
  const bea = await upsertPerson(elsewhere, {
    name: 'Bea Byron',
    emails: ['bea@byron.example'],
    company: { domain: 'byron.example', name: 'Byron Works' },
  });
  otherPersonId = bea.person.id;
  otherLeadId = (
    await createLead(elsewhere, { personId: otherPersonId, pipelineId: brand.pipeline.id })
  ).lead.id;
  for (const name of ['Cy Cole', 'Dee Dunn']) {
    const person = await upsertPerson(elsewhere, { name });
    await createLead(elsewhere, { personId: person.person.id, pipelineId: brand.pipeline.id });
  }
  otherViewId = (
    await createSavedView(elsewhere, {
      object: 'lead',
      pipelineId: brand.pipeline.id,
      name: 'Elsewhere view',
      visibility: 'workspace',
    })
  ).view.id;
}

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
  mainPipelineId = brand.pipeline.id;
  mainLeadId = (await createLead(context, { personId, pipelineId: brand.pipeline.id })).lead.id;
  await createLead(context, {
    personId: grace.person.id,
    pipelineId: brand.pipeline.id,
    stageId: readyId,
  });
  mainViewId = (
    await createSavedView(context, {
      object: 'lead',
      pipelineId: brand.pipeline.id,
      name: 'Ready ones',
      visibility: 'workspace',
      filter: READY_FILTER(),
    })
  ).view.id;
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
  await seedQuill(context, harbor.pipeline.id);
  await seedCrowd(context, harbor.pipeline.id);
  await seedElsewhere();
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

  test('structured content is bounded like the text and leaves out colleagues contact details', async () => {
    const { text, data } = await client.result('get_context', { ref: 'crowd.example' });
    expect(text).toContain('Company: Crowd Co');
    const people = data['people'] as Record<string, unknown>[];
    expect(people).toHaveLength(20);
    expect(data['peopleTotal']).toBe(CROWD_SIZE);
    expect(Object.keys(people[0] ?? {}).sort()).toEqual(['id', 'name', 'title', 'url']);
    expect(JSON.stringify(data)).not.toContain('@crowd.example');
    expect(JSON.stringify(data)).not.toContain('+1 555');
    expect(data['leads'] as unknown[]).toHaveLength(20);
    expect(data['leadsTotal']).toBe(CROWD_SIZE);
    const person = await client.result('get_context', { ref: 'ada@vela.example' });
    expect(person.data['leadsTotal']).toBe(1);
    expect(person.data['peopleTotal']).toBe(0);
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

  test('a saved view is pruned exactly as the web app prunes it', async () => {
    const everywhere = await client.result('list_leads', { pipeline: 'QUI', view: 'Everywhere' });
    expect(keysOf(everywhere.data)).toEqual(['QUI-2', 'QUI-1']);
    const removedField = await client.result('list_leads', { pipeline: 'QUI', view: 'Gold ready' });
    expect(keysOf(removedField.data)).toEqual(['QUI-1']);
    const strict = await client.failure('list_leads', {
      pipeline: 'QUI',
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          { kind: 'condition', property: 'fields.tier', operator: 'contains', value: 'x' },
        ],
      },
    });
    expect(strict.code).toBe('validation_failed');
    expect(strict.message).toContain('There is no lead filter called fields.tier.');
  });

  test('a view and a filter nest instead of merging when one group would hold too many', async () => {
    const listed = await client.result('list_leads', {
      pipeline: 'QUI',
      view: 'Thirty',
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          ...Array.from({ length: 15 }, () => stageCondition(quillReadyId)),
          ...Array.from({ length: 10 }, emptyGroup),
        ],
      },
    });
    expect(keysOf(listed.data)).toEqual(['QUI-1']);
  });

  test('list and search lines collapse line breaks and control characters', async () => {
    const listed = await client.result('list_leads', { pipeline: 'QUI' });
    const lines = listed.text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.find((line) => line.startsWith('- QUI-1'))).toContain(
      'Nia North · Ready · Ada Admin · No priority · next: Call then email',
    );
    const found = await client.result('search', { query: 'Nia' });
    expect(found.text.split('\n')).toContain(
      `- Nia North <nia@quill.example> ${String((found.data['people'] as { url: string }[])[0]?.url)}`,
    );
    expect(found.text.split('\n').some((line) => /\p{Cc}/u.test(line))).toBe(false);
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
      message: 'There is no pipeline NOPE. Pipelines: HAR, LUM, QUI.',
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
  test('from the first workspace, nothing of the second is reachable, even with the same keys', async () => {
    const own = await client.result('get_context', { ref: 'LUM-1' });
    expect(own.data['subject']).toMatchObject({ type: 'lead', id: mainLeadId });
    expect(own.text).toContain('Ada Lovelace');
    expect(own.text).not.toContain('Bea Byron');
    for (const ref of ['LUM-3', otherLeadId, otherPersonId, 'bea@byron.example', 'byron.example']) {
      expect((await client.failure('get_context', { ref })).code).toBe('not_found');
    }
    expect((await client.failure('list_leads', { pipeline: otherPipelineId })).code).toBe(
      'not_found',
    );
    expect((await client.failure('list_leads', { pipeline: 'LUM', view: otherViewId })).code).toBe(
      'not_found',
    );
    for (const query of ['Byron', 'LUM-3']) {
      const { data } = await client.result('search', { query });
      expect([data['people'], data['companies'], data['leads']]).toEqual([[], [], []]);
    }
  });

  test('from the second workspace, nothing of the first is reachable, even with the same keys', async () => {
    const elsewhere = await connect(
      (await mintMcpToken(otherWorkspaceId, workspace.adminUser.id)).token,
    );
    try {
      const theirs = await elsewhere.result('get_context', { ref: 'LUM-1' });
      expect(theirs.data['subject']).toMatchObject({ type: 'lead', id: otherLeadId });
      expect(theirs.text).toContain('Bea Byron');
      expect(keysOf((await elsewhere.result('list_leads', { pipeline: 'LUM' })).data)).toEqual([
        'LUM-3',
        'LUM-2',
        'LUM-1',
      ]);
      const byron = await elsewhere.result('search', { query: 'Byron' });
      expect(byron.data['people']).toEqual([expect.objectContaining({ name: 'Bea Byron' })]);
      expect(byron.data['companies']).toEqual([expect.objectContaining({ name: 'Byron Works' })]);
      for (const ref of [mainLeadId, personId, 'ada@vela.example', 'vela.example']) {
        expect((await elsewhere.failure('get_context', { ref })).code).toBe('not_found');
      }
      expect((await elsewhere.failure('list_leads', { pipeline: mainPipelineId })).code).toBe(
        'not_found',
      );
      expect(
        (await elsewhere.failure('list_leads', { pipeline: 'LUM', view: mainViewId })).code,
      ).toBe('not_found');
      for (const query of ['Lovelace', 'Vela']) {
        const { data } = await elsewhere.result('search', { query });
        expect([data['people'], data['companies'], data['leads']]).toEqual([[], [], []]);
      }
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
