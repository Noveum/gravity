import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createBrand,
  createLead,
  getRecordContext,
  renderRecordContext,
  updatePerson,
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

  test('names what was copied and is never cached', async () => {
    const person = await ask(`ref=${personId}`);
    expect(person.headers.get('cache-control')).toBe('private, no-store');
    expect(((await person.json()) as { label: string }).label).toBe('Ada Lovelace');
    const lead = (await (await ask(`ref=${leadKey}`)).json()) as { label: string };
    expect(lead.label).toBe(`${leadKey} · Ada Lovelace`);
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

  test('a record too large for the budget is cut, shorter and marked', async () => {
    for (let index = 0; index < 40; index += 1) {
      await updatePerson({ principal: workspace.admin }, personId, { location: `City ${index}` });
    }
    const small = await textOf(await ask(`ref=${personId}&maxTokens=${CONTEXT_TOKENS.min}`));
    const large = await textOf(await ask(`ref=${personId}&maxTokens=${CONTEXT_TOKENS.max}`));
    expect(small.length).toBeLessThanOrEqual(CONTEXT_TOKENS.min * 4);
    expect(small.length).toBeLessThan(large.length);
    expect(small).toMatch(/\(\d+ older entries left out to fit 200 tokens\)/);
    expect(large).not.toContain('left out to fit');
  });

  test('a budget outside the bounds is brought inside them, as in the MCP tool', async () => {
    const low = await ask(`ref=${personId}&maxTokens=10`);
    expect(low.status).toBe(200);
    const subject = { type: 'person', id: personId } as const;
    const expected = renderRecordContext(await getRecordContext(workspace.admin, subject), {
      maxTokens: CONTEXT_TOKENS.min,
      links: recordLinks(ORIGIN),
    });
    expect(await textOf(low)).toBe(expected);
    expect((await ask(`ref=${personId}&maxTokens=999999`)).status).toBe(200);
  });

  test('refuses a missing ref and a budget that is not a whole number', async () => {
    expect((await ask('maxTokens=500')).status).toBe(422);
    expect((await ask(`ref=${personId}&maxTokens=abc`)).status).toBe(422);
    expect((await ask(`ref=${personId}&maxTokens=1.5`)).status).toBe(422);
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
