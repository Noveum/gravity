import { beforeEach, describe, expect, test } from 'bun:test';
import { createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, eq, schema, sql } from '@gravity/db';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { activeSessionFor, mockSession } from '../../../tests-support.ts';

let current: ActiveSession | null = null;
mockSession(() => current);

const { default: AppLayout } = await import('@/app/(app)/layout.tsx');

beforeEach(async () => {
  await resetDatabase();
});

describe('app layout', () => {
  test('wraps the page in the shell for an active workspace', async () => {
    const workspace = await createWorkspace('Acme');
    current = activeSessionFor(workspace.adminUser, workspace.organizationId);
    const element = await AppLayout({ children: null });
    expect(element.props.workspace).toMatchObject({ id: workspace.organizationId, name: 'Acme' });
  });

  test('seeds the realtime cursor with the workspace latest outbox sync id', async () => {
    const workspace = await createWorkspace('Acme');
    const [latest] = await db
      .select({ value: sql<number>`max(${schema.outbox.syncId})::int` })
      .from(schema.outbox)
      .where(eq(schema.outbox.organizationId, workspace.organizationId));
    current = activeSessionFor(workspace.adminUser, workspace.organizationId);
    const element = await AppLayout({ children: null });
    expect(latest?.value).toBeGreaterThan(0);
    expect(element.props.realtimeCursor).toBe(latest?.value);
  });

  test('seeds zero for a workspace with no outbox history', async () => {
    const workspace = await createWorkspace('Acme');
    await db.delete(schema.outbox);
    current = activeSessionFor(workspace.adminUser, workspace.organizationId);
    const element = await AppLayout({ children: null });
    expect(element.props.realtimeCursor).toBe(0);
  });

  test('still renders for a workspace being deleted so settings can load without a redirect loop', async () => {
    const workspace = await createWorkspace('Doomed');
    await db.update(schema.organization).set({ deletionRequestedAt: new Date() });
    current = activeSessionFor(workspace.adminUser, workspace.organizationId);
    const element = await AppLayout({ children: null });
    expect(element.props.workspace).toMatchObject({ id: workspace.organizationId });
  });

  test('sends a signed in user without a workspace to onboarding', async () => {
    const workspace = await createWorkspace();
    await db.delete(schema.member);
    current = activeSessionFor(workspace.adminUser);
    await expect(AppLayout({ children: null })).rejects.toMatchObject({
      digest: expect.stringContaining('/onboarding'),
    });
  });
});
