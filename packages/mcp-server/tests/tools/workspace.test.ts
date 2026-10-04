import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeRealtime, createBrand, createFieldDefinition, createSavedView } from '@gravity/core';
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
let brandId = '';

async function publishPlaybook(body: string): Promise<void> {
  await db.insert(schema.playbookVersion).values({
    id: crypto.randomUUID(),
    organizationId: workspace.organizationId,
    brandId,
    version: 2,
    body,
  });
  await db
    .update(schema.brand)
    .set({ currentPlaybookVersion: 2 })
    .where(eq(schema.brand.id, brandId));
}

interface BrandView {
  name: string;
  playbook: unknown;
  pipelines: { key: string; url: string; stages: { name: string }[]; fields: { key: string }[] }[];
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nimbus');
  const context = { principal: workspace.admin };
  const brand = await createBrand(context, { name: 'Lumen', pipelineKey: 'LUM' });
  brandId = brand.brand.id;
  await createFieldDefinition(context, {
    object: 'person',
    key: 'seniority',
    label: 'Seniority',
    type: 'select',
    options: [
      { value: 'junior', label: 'Junior' },
      { value: 'senior', label: 'Senior' },
    ],
  });
  await createFieldDefinition(context, {
    object: 'lead',
    pipelineId: brand.pipeline.id,
    key: 'deal_size',
    label: 'Deal size',
    type: 'number',
  });
  await createSavedView(context, {
    object: 'lead',
    pipelineId: brand.pipeline.id,
    name: 'Hot leads',
    visibility: 'workspace',
  });
  const teammate = await addMember(workspace, 'Tess Teammate', 'member');
  await createSavedView({ principal: teammate }, { object: 'person', name: 'Tess only' });
  client = await connect(
    (await mintMcpToken(workspace.organizationId, workspace.adminUser.id)).token,
  );
});

afterEach(async () => {
  await client.close();
});

afterAll(async () => {
  await closeRealtime();
});

describe('describe_workspace', () => {
  test('describes brands, pipelines with stages and fields, members and visible views', async () => {
    const { text, data } = await client.result('describe_workspace');
    expect(data['workspace']).toMatchObject({ name: 'Nimbus', url: 'http://localhost:3300/leads' });
    expect(data['me']).toEqual({ userId: workspace.adminUser.id, role: 'admin' });
    const brands = data['brands'] as BrandView[];
    expect(brands.map((brand) => brand.name)).toEqual(['Lumen']);
    const pipeline = brands[0]?.pipelines[0];
    expect(pipeline?.key).toBe('LUM');
    expect(pipeline?.url).toBe('http://localhost:3300/leads/LUM');
    expect(pipeline?.stages).toHaveLength(13);
    expect(pipeline?.fields.map((field) => field.key)).toEqual(['deal_size']);
    expect(brands[0]?.playbook).toEqual({ version: 1, body: '' });
    expect((data['fields'] as { person: { key: string; options: string[] }[] }).person).toEqual([
      expect.objectContaining({ key: 'seniority', options: ['junior', 'senior'] }),
    ]);
    expect((data['savedViews'] as { name: string }[]).map((view) => view.name)).toEqual([
      'Hot leads',
    ]);
    expect((data['members'] as { email: string }[]).map((member) => member.email)).toContain(
      workspace.adminUser.email,
    );
    expect(text).toContain('Pipeline LUM Prospecting');
    expect(text).toContain('Saved view Hot leads');
    expect(text).not.toContain('Tess only');
    expect(text.trimStart().startsWith('{')).toBe(false);
  });

  test('describes only the workspace the token was granted for', async () => {
    const other = await createWorkspace('Elsewhere');
    await createBrand({ principal: other.admin }, { name: 'Harbor', pipelineKey: 'HAR' });
    const elsewhere = await connect(
      (await mintMcpToken(other.organizationId, other.adminUser.id)).token,
    );
    try {
      const { text, data } = await elsewhere.result('describe_workspace');
      expect((data['brands'] as BrandView[]).map((brand) => brand.name)).toEqual(['Harbor']);
      expect(data['workspace']).toMatchObject({ name: 'Elsewhere' });
      expect(text).not.toContain('Lumen');
      expect(text).not.toContain(workspace.adminUser.email);
    } finally {
      await elsewhere.close();
    }
  });

  test('puts each playbook body in the text, not only in the structured content', async () => {
    await publishPlaybook('Lead with the audit.\nNever pitch on the first touch.');
    const { text, data } = await client.result('describe_workspace');
    expect(text).toContain('Brand Lumen, playbook v2');
    expect(text).toContain('    Lead with the audit.\n    Never pitch on the first touch.');
    expect((data['brands'] as BrandView[])[0]?.playbook).toEqual({
      version: 2,
      body: 'Lead with the audit.\nNever pitch on the first touch.',
    });
  });

  test('cuts a playbook that would blow the token budget and says where the rest is', async () => {
    const body = 'Audit first. '.repeat(20_000);
    await publishPlaybook(body);
    const { text, data } = await client.result('describe_workspace');
    expect(text.length).toBeLessThan(CONTEXT_TOKENS.max * 4 + 8_000);
    expect(text).toContain('Audit first.');
    expect(text).toContain('playbook cut to fit');
    expect((data['brands'] as BrandView[])[0]?.playbook).toEqual({ version: 2, body });
  });
});
