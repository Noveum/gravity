import { beforeEach, describe, expect, test } from 'bun:test';
import { createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { render, screen } from '@testing-library/react';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { activeSessionFor, mockSession } from '../../../../tests-support.ts';

let current: ActiveSession | null = null;
mockSession(() => current);

const { default: SectionPage } = await import('@/app/(app)/[section]/page.tsx');

function params(section: string) {
  return { params: Promise.resolve({ section }) };
}

beforeEach(async () => {
  await resetDatabase();
  const workspace = await createWorkspace();
  current = activeSessionFor(workspace.adminUser, workspace.organizationId);
});

describe('section page', () => {
  test('shows an empty state for a navigable section', async () => {
    render(await SectionPage(params('deals')));
    expect(screen.getByText('Deals')).toBeInTheDocument();
    expect(screen.getByText(/arrives in the next milestone/)).toBeInTheDocument();
  });

  test('is not found for an unknown section', async () => {
    await expect(SectionPage(params('issues'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  test('is not found for settings, which has its own pages', async () => {
    await expect(SectionPage(params('settings'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  test('sends a workspace that is being deleted to its settings', async () => {
    await db.update(schema.organization).set({ deletionRequestedAt: new Date() });
    await expect(SectionPage(params('today'))).rejects.toMatchObject({
      digest: expect.stringContaining('/settings/members'),
    });
  });
});
