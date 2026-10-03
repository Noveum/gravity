import { beforeEach, describe, expect, test } from 'bun:test';
import { newId, pruneOutbox, recordSync } from '@gravity/core';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, inArray, schema } from '@gravity/db';
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

function syncUrl(organizationId: string, since: number): string {
  return `http://localhost:3300/api/sync?organizationId=${organizationId}&since=${since}`;
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
    const body = await (await GET(new Request(syncUrl(mine.organizationId, 0)))).json();
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
    const body = await (await GET(new Request(syncUrl(mine.organizationId, 0)))).json();
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

    const first = await (await GET(new Request(syncUrl(mine.organizationId, 0)))).json();
    expect(first.actions).toHaveLength(CATCHUP_LIMIT);
    expect(first.truncated).toBe(true);
    expect(first.syncId).toBe(7000 + CATCHUP_LIMIT - 1);

    const second = await (
      await GET(new Request(syncUrl(mine.organizationId, first.syncId)))
    ).json();
    expect(second.actions.map((row: SyncAction) => row.syncId)).toEqual([
      7000 + CATCHUP_LIMIT,
      7000 + CATCHUP_LIMIT + 1,
    ]);
    expect(second.truncated).toBe(false);
  });

  test('replays the requested workspace even when the session is active on another', async () => {
    const asked = await createWorkspace('Asked');
    const active = await createWorkspace('Active');
    await db.insert(schema.member).values({
      id: newId(),
      organizationId: asked.organizationId,
      userId: active.adminUser.id,
      role: 'member',
    });
    await db.delete(schema.outbox);
    await recordSync(db, [
      action(asked.organizationId, 8001, 'insert'),
      action(active.organizationId, 8002, 'insert'),
    ]);
    await signedInAs(active.adminUser.id, active.organizationId);

    const askedBody = await (await GET(new Request(syncUrl(asked.organizationId, 0)))).json();
    expect(askedBody.actions.map((row: SyncAction) => row.syncId)).toEqual([8001]);
    const activeBody = await (await GET(new Request(syncUrl(active.organizationId, 0)))).json();
    expect(activeBody.actions.map((row: SyncAction) => row.syncId)).toEqual([8002]);
  });

  test('refuses a workspace the caller is not a member of', async () => {
    const mine = await createWorkspace('Mine');
    const other = await createWorkspace('Other');
    await db.delete(schema.outbox);
    await recordSync(db, [action(other.organizationId, 8101, 'insert')]);
    await signedInAs(mine.adminUser.id, mine.organizationId);
    const response = await GET(new Request(syncUrl(other.organizationId, 0)));
    expect(response.status).toBe(403);
  });

  test('refuses a request that does not name a workspace', async () => {
    const mine = await createWorkspace('Mine');
    await signedInAs(mine.adminUser.id, mine.organizationId);
    const response = await GET(new Request('http://localhost:3300/api/sync?since=0'));
    expect(response.status).toBe(422);
  });

  test('tells a client whose cursor is older than the pruned history to reset', async () => {
    const mine = await createWorkspace('Mine');
    await db.delete(schema.outbox);
    await recordSync(db, [
      action(mine.organizationId, 9001, 'insert'),
      action(mine.organizationId, 9002, 'update'),
      action(mine.organizationId, 9003, 'update'),
    ]);
    await db
      .update(schema.outbox)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60_000) })
      .where(inArray(schema.outbox.syncId, [9001, 9002]));
    await pruneOutbox(7 * 24 * 60 * 60_000);
    await signedInAs(mine.adminUser.id, mine.organizationId);

    const behind = await (await GET(new Request(syncUrl(mine.organizationId, 9001)))).json();
    expect(behind).toEqual({ actions: [], truncated: false, reset: true, syncId: 9003 });

    const overlapped = await (
      await GET(new Request(`${syncUrl(mine.organizationId, 8000)}&cursor=9002`))
    ).json();
    expect(overlapped.reset).toBe(false);
    expect(overlapped.actions.map((row: SyncAction) => row.syncId)).toEqual([9003]);
  });

  test('refuses a caller without a session', async () => {
    const mine = await createWorkspace('Mine');
    signedOut();
    const response = await GET(new Request(syncUrl(mine.organizationId, 0)));
    expect(response.status).toBe(401);
  });
});
