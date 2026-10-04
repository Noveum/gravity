import { beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema, sql } from '../../src/index.ts';
import { violation } from '../support/violation.ts';

beforeEach(async () => {
  await db.execute(sql`truncate table organization restart identity cascade`);
  await db.insert(schema.organization).values([
    { id: 'o1', name: 'Acme', slug: 'acme' },
    { id: 'o2', name: 'Other', slug: 'other' },
  ]);
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
    ).toEqual({ code: '23505', constraint: 'import_source_pk' });
    await db
      .insert(schema.importSource)
      .values({ organizationId: 'o1', source: 'sheet', sourceId: '7', personId: 'per2' });
    expect(await db.select().from(schema.importSource)).toHaveLength(2);
  });

  test('cannot link a person of another workspace', async () => {
    expect(
      await violation(() =>
        db
          .insert(schema.importSource)
          .values({ organizationId: 'o2', source: 'crm', sourceId: '7', personId: 'per1' }),
      ),
    ).toEqual({ code: '23503', constraint: 'import_source_person_fk' });
    expect(await db.select().from(schema.importSource)).toHaveLength(0);
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
