import { beforeEach, describe, expect, test } from 'bun:test';
import { createBrand, createLead, upsertPerson } from '@gravity/core';
import { createWorkspace, resetDatabase, type TestWorkspace } from '@gravity/core/test-support';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { activeSessionFor, mockSession } from '../../../../../tests-support.ts';

let current: ActiveSession | null = null;
mockSession(() => current);

const { default: LeadKeyPage } = await import('@/app/(app)/l/[identifier]/page.tsx');

let workspace: TestWorkspace;
let personId = '';
let leadId = '';

function params(identifier: string) {
  return { params: Promise.resolve({ identifier }) };
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const brand = await createBrand({ principal: workspace.admin }, { name: 'Yodu' });
  personId = (
    await upsertPerson(
      { principal: workspace.admin },
      { name: 'Ada Lovelace', emails: ['ada@acme.io'] },
    )
  ).person.id;
  leadId = (
    await createLead({ principal: workspace.admin }, { personId, pipelineId: brand.pipeline.id })
  ).lead.id;
  current = activeSessionFor(workspace.adminUser, workspace.organizationId);
});

describe('/l/[identifier]', () => {
  test('sends a lead key to its person with the lead in focus', async () => {
    await expect(LeadKeyPage(params('YOD-1'))).rejects.toMatchObject({
      digest: expect.stringContaining(`/people/${personId}?lead=${leadId}`),
    });
  });

  test('accepts a lower case or encoded key', async () => {
    await expect(LeadKeyPage(params('yod-1'))).rejects.toMatchObject({
      digest: expect.stringContaining(`/people/${personId}?lead=${leadId}`),
    });
    await expect(LeadKeyPage(params('YOD%2D1'))).rejects.toMatchObject({
      digest: expect.stringContaining(`/people/${personId}?lead=${leadId}`),
    });
  });

  test('is not found for a key that does not exist or cannot be decoded', async () => {
    await expect(LeadKeyPage(params('YOD-99'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
    await expect(LeadKeyPage(params('%E0%A4%A'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  test('never resolves a lead from another workspace', async () => {
    const other = await createWorkspace('Other');
    current = activeSessionFor(other.adminUser, other.organizationId);
    await expect(LeadKeyPage(params('YOD-1'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });
});
