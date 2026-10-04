import { beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema, sql } from '../../src/index.ts';

async function violation(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
  } catch (error: unknown) {
    let cursor: unknown = error;
    for (let depth = 0; depth < 5; depth += 1) {
      if (typeof cursor !== 'object' || cursor === null) break;
      const constraint = (cursor as { constraint_name?: unknown }).constraint_name;
      if (typeof constraint === 'string') return constraint;
      cursor = (cursor as { cause?: unknown }).cause;
    }
    return 'unknown';
  }
  return null;
}

beforeEach(async () => {
  await db.execute(sql`truncate table organization, "user" restart identity cascade`);
  await db.insert(schema.organization).values({ id: 'o1', name: 'Acme', slug: 'acme' });
  await db.insert(schema.person).values([
    { id: 'per1', organizationId: 'o1', name: 'Ada' },
    { id: 'per2', organizationId: 'o1', name: 'Grace' },
  ]);
});

describe('import_source', () => {
  test('links one source id to one person per workspace and source', async () => {
    await db
      .insert(schema.importSource)
      .values({ organizationId: 'o1', source: 'crm', sourceId: '7', personId: 'per1' });
    expect(
      await violation(() =>
        db
          .insert(schema.importSource)
          .values({ organizationId: 'o1', source: 'crm', sourceId: '7', personId: 'per2' }),
      ),
    ).toBe('import_source_pk');
    await db
      .insert(schema.importSource)
      .values({ organizationId: 'o1', source: 'sheet', sourceId: '7', personId: 'per2' });
    expect(await db.select().from(schema.importSource)).toHaveLength(2);
  });

  test('disappears with its person', async () => {
    await db
      .insert(schema.importSource)
      .values({ organizationId: 'o1', source: 'crm', sourceId: '7', personId: 'per1' });
    await db.delete(schema.person).where(eq(schema.person.id, 'per1'));
    expect(await db.select().from(schema.importSource)).toHaveLength(0);
  });

  test('disappears with its workspace', async () => {
    await db
      .insert(schema.importSource)
      .values({ organizationId: 'o1', source: 'crm', sourceId: '7', personId: 'per1' });
    await db.delete(schema.organization).where(eq(schema.organization.id, 'o1'));
    expect(await db.select().from(schema.importSource)).toHaveLength(0);
  });
});
