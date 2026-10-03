import { beforeEach, describe, expect, test } from 'bun:test';
import { createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { GET } from '@/app/api/cron/outbox/route.ts';

beforeEach(async () => {
  await resetDatabase();
  process.env['CRON_SECRET'] = 'cron-test-secret';
});

describe('/api/cron/outbox', () => {
  test('refuses a request without the cron secret', async () => {
    const response = await GET(new Request('http://localhost:3300/api/cron/outbox'));
    expect(response.status).toBe(401);
  });

  test('runs with the cron secret', async () => {
    const response = await GET(
      new Request('http://localhost:3300/api/cron/outbox', {
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ published: 0, pruned: 0 });
  });

  test('prunes outbox rows older than seven days and keeps newer ones', async () => {
    const workspace = await createWorkspace();
    await db.delete(schema.outbox);
    const row = (syncId: number, createdAt: Date) => ({
      syncId,
      organizationId: workspace.organizationId,
      payload: {},
      createdAt,
      publishedAt: new Date(),
    });
    const day = 24 * 60 * 60_000;
    await db
      .insert(schema.outbox)
      .values([
        row(9001, new Date(Date.now() - 8 * day)),
        row(9002, new Date(Date.now() - 6 * day)),
        row(9003, new Date()),
      ]);

    const response = await GET(
      new Request('http://localhost:3300/api/cron/outbox', {
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    );

    expect(await response.json()).toEqual({ published: 0, pruned: 1 });
    const left = await db.select().from(schema.outbox);
    expect(left.map((entry) => entry.syncId).sort()).toEqual([9002, 9003]);
    expect(await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 9001))).toEqual([]);
  });
});
