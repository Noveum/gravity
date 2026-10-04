import { beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, isNull, schema, sql } from '../../src/index.ts';

beforeEach(async () => {
  await db.execute(sql`truncate table outbox, organization restart identity cascade`);
  await db.insert(schema.organization).values({ id: 'o1', name: 'Acme', slug: 'acme' });
});

describe('outbox', () => {
  test('stores a payload against a sync id and starts unpublished', async () => {
    await db.insert(schema.outbox).values({ syncId: 41, organizationId: 'o1', payload: { a: 1 } });
    const pending = await db.select().from(schema.outbox).where(isNull(schema.outbox.publishedAt));
    expect(pending.map((row) => row.syncId)).toEqual([41]);
  });

  test('cascades away with its organization', async () => {
    await db.insert(schema.outbox).values({ syncId: 42, organizationId: 'o1', payload: {} });
    await db.delete(schema.organization).where(eq(schema.organization.id, 'o1'));
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });
});
