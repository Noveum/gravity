import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { listViewPreferences, saveViewPreference } from '../../src/crm/view-preference-service.ts';
import { newId } from '../../src/internal.ts';
import { resolvePrincipal } from '../../src/org/member-service.ts';
import { createOrganization } from '../../src/org/organization-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

describe('view preferences', () => {
  test('upsert per page and scope and stay per user', async () => {
    await saveViewPreference(workspace.admin, { page: 'leads', scope: 'p1', layout: 'list' });
    await saveViewPreference(workspace.admin, { page: 'leads', scope: 'p1', layout: 'board' });
    await saveViewPreference(workspace.admin, {
      page: 'context-panel',
      display: { width: 512, open: true },
    });
    const mine = await listViewPreferences(workspace.admin);
    expect(mine.find((entry) => entry.page === 'leads')?.layout).toBe('board');
    expect(mine).toHaveLength(2);
    const teammate = await addMember(workspace, 'Tess', 'member');
    expect(await listViewPreferences(teammate)).toHaveLength(0);
  });

  test('refuses a layout it does not know and a page name that is not lowercase', async () => {
    await expect(
      saveViewPreference(workspace.admin, { page: 'leads', layout: 'gallery' }),
    ).rejects.toThrow();
    await expect(saveViewPreference(workspace.admin, { page: 'Leads' })).rejects.toThrow();
    expect(await listViewPreferences(workspace.admin)).toHaveLength(0);
  });

  test('keeps a user preference apart per workspace and defaults the scope', async () => {
    const saved = await saveViewPreference(workspace.admin, { page: 'people' });
    expect(saved).toEqual({ page: 'people', scope: '', layout: 'list', display: {} });
    const second = await createOrganization(workspace.adminUser.id, {
      name: 'Second',
      slug: `second-${newId().slice(-8)}`,
    });
    const inSecond = await resolvePrincipal(workspace.adminUser.id, second.organization.id);
    expect(await listViewPreferences(inSecond)).toHaveLength(0);
    expect(await listViewPreferences(workspace.admin)).toHaveLength(1);
  });
});
