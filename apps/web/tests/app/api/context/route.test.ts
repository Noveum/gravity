import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createBrand,
  createLead,
  getRecordContext,
  renderRecordContext,
  upsertPerson,
} from '@gravity/core';
import {
  createMemberPrincipal,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { CONTEXT_TOKENS } from '@gravity/shared/constants';
import { recordLinks } from '@gravity/shared/utils';
import { GET } from '@/app/api/context/route.ts';
import { signedInAs, signedOut } from '../../../../tests-support.ts';

const ORIGIN = 'http://localhost:3300';

let workspace: TestWorkspace;
let personId = '';
let leadId = '';
let leadKey = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  personId = (
    await upsertPerson(
      { principal: workspace.admin },
      { name: 'Ada Lovelace', emails: ['ada@vela.example'] },
    )
  ).person.id;
  const created = await createLead(
    { principal: workspace.admin },
    { personId, pipelineId: brand.pipeline.id },
  );
  leadId = created.lead.id;
  leadKey = created.lead.key;
  await signedInAs(workspace.adminUser.id, workspace.organizationId);
});

function ask(query: string): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/context?${query}`));
}

async function textOf(response: Response): Promise<string> {
  return ((await response.json()) as { text: string }).text;
}

describe('/api/context', () => {
  test('returns the agent text for a record id', async () => {
    const response = await ask(`ref=${personId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { subject: unknown; text: string };
    expect(body.subject).toEqual({ type: 'person', id: personId });
    expect(body.text).toContain('Person: Ada Lovelace <ada@vela.example>');
    expect(body.text).toContain(`${ORIGIN}/people/${personId}`);
  });

  test('a lead id or key puts that lead in focus', async () => {
    const byId = await ask(`ref=${leadId}`);
    expect(((await byId.json()) as { subject: unknown }).subject).toEqual({
      type: 'lead',
      id: leadId,
    });
    const byKey = await ask(`ref=${leadKey}`);
    const text = await textOf(byKey);
    expect(text).toContain(`${leadKey} (in focus)`);
  });

  test('is the same text an agent gets from the shared renderer', async () => {
    const subject = { type: 'person', id: personId } as const;
    const expected = renderRecordContext(await getRecordContext(workspace.admin, subject), {
      maxTokens: 700,
      links: recordLinks(ORIGIN),
    });
    expect(await textOf(await ask(`ref=${personId}&maxTokens=700`))).toBe(expected);
  });

  test('a smaller token budget gives a shorter text', async () => {
    const small = await textOf(await ask(`ref=${personId}&maxTokens=${CONTEXT_TOKENS.min}`));
    const large = await textOf(await ask(`ref=${personId}&maxTokens=${CONTEXT_TOKENS.max}`));
    expect(small.length).toBeLessThanOrEqual(CONTEXT_TOKENS.min * 4);
    expect(large.length).toBeGreaterThanOrEqual(small.length);
  });

  test('refuses a missing ref and a token budget outside the bounds', async () => {
    expect((await ask('maxTokens=500')).status).toBe(422);
    expect((await ask(`ref=${personId}&maxTokens=${CONTEXT_TOKENS.min - 1}`)).status).toBe(422);
    expect((await ask(`ref=${personId}&maxTokens=${CONTEXT_TOKENS.max + 1}`)).status).toBe(422);
    expect((await ask(`ref=${personId}&maxTokens=abc`)).status).toBe(422);
  });

  test('answers not found for an unknown ref and for a record of another workspace', async () => {
    expect((await ask('ref=nobody-here')).status).toBe(404);
    const other = await createWorkspace('Other');
    await signedInAs(other.adminUser.id, other.organizationId);
    expect((await ask(`ref=${personId}`)).status).toBe(404);
    expect((await ask(`ref=${leadId}`)).status).toBe(404);
    expect((await ask('ref=ada@vela.example')).status).toBe(404);
  });

  test('a guest, who may only read, can copy a record', async () => {
    const guest = await createMemberPrincipal(workspace, 'guest');
    await signedInAs(guest.userId, workspace.organizationId);
    const response = await ask(`ref=${personId}`);
    expect(response.status).toBe(200);
    expect(await textOf(response)).toContain('Ada Lovelace');
  });

  test('refuses a caller who is not signed in', async () => {
    signedOut();
    expect((await ask(`ref=${personId}`)).status).toBe(401);
  });
});
