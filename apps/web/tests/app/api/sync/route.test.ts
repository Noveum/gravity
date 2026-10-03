import { beforeEach, describe, expect, test } from 'bun:test';
import { recordSync } from '@gravity/core';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { CATCHUP_LIMIT, type SyncAction } from '@gravity/shared/events';
import { GET } from '@/app/api/sync/route.ts';
import { signedInAs, signedOut } from '../../../../tests-support.ts';

function action(organizationId: string, syncId: number, kind: SyncAction['action']): SyncAction {
  return {
    syncId,
    organizationId,
    scopes: [`workspace:${organizationId}`],
    action: kind,
    model: 'member',
    modelId: `m${syncId}`,
    data: {},
    actor: { type: 'system', id: 'test' },
    at: new Date(0).toISOString(),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('/api/sync', () => {
  test('replays only the caller workspace, in order, including deletes', async () => {
    const mine = await createWorkspace('Mine');
    const other = await createWorkspace('Other');
    await db.delete(schema.outbox);
    await recordSync(db, [
      action(mine.organizationId, 5001, 'insert'),
      action(other.organizationId, 5002, 'insert'),
      action(mine.organizationId, 5003, 'delete'),
    ]);
    await signedInAs(mine.adminUser.id, mine.organizationId);
    const body = await (await GET(new Request('http://localhost:3300/api/sync?since=0'))).json();
    expect(body.actions.map((row: SyncAction) => [row.syncId, row.action])).toEqual([
      [5001, 'insert'],
      [5003, 'delete'],
    ]);
    expect(body.truncated).toBe(false);
    expect(body.syncId).toBe(5003);
  });

  test('keeps user-scoped actions for their owner only', async () => {
    const mine = await createWorkspace('Mine');
    const colleague = await createUser('Colleague');
    await db.delete(schema.outbox);
    const forUser = (syncId: number, userId: string): SyncAction => ({
      ...action(mine.organizationId, syncId, 'update'),
      scopes: [`user:${userId}`],
    });
    await recordSync(db, [
      action(mine.organizationId, 6001, 'insert'),
      forUser(6002, colleague.id),
      forUser(6003, mine.adminUser.id),
    ]);
    await signedInAs(mine.adminUser.id, mine.organizationId);
    const body = await (await GET(new Request('http://localhost:3300/api/sync?since=0'))).json();
    expect(body.actions.map((row: SyncAction) => row.syncId)).toEqual([6001, 6003]);
  });

  test('says truncated past the limit and hands back the cursor for the next page', async () => {
    const mine = await createWorkspace('Mine');
    await db.delete(schema.outbox);
    await recordSync(
      db,
      Array.from({ length: CATCHUP_LIMIT + 2 }, (_, index) =>
        action(mine.organizationId, 7000 + index, 'update'),
      ),
    );
    await signedInAs(mine.adminUser.id, mine.organizationId);

    const first = await (await GET(new Request('http://localhost:3300/api/sync?since=0'))).json();
    expect(first.actions).toHaveLength(CATCHUP_LIMIT);
    expect(first.truncated).toBe(true);
    expect(first.syncId).toBe(7000 + CATCHUP_LIMIT - 1);

    const second = await (
      await GET(new Request(`http://localhost:3300/api/sync?since=${first.syncId}`))
    ).json();
    expect(second.actions.map((row: SyncAction) => row.syncId)).toEqual([
      7000 + CATCHUP_LIMIT,
      7000 + CATCHUP_LIMIT + 1,
    ]);
    expect(second.truncated).toBe(false);
  });

  test('refuses a caller without a session', async () => {
    signedOut();
    const response = await GET(new Request('http://localhost:3300/api/sync?since=0'));
    expect(response.status).toBe(401);
  });
});
