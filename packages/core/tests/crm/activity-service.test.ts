import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { db, schema } from '@gravity/db';
import { diffValues, listTimeline, recordActivity } from '../../src/crm/activity-service.ts';
import { encodeCursor } from '../../src/crm/cursor.ts';
import { withBatch } from '../../src/crm/sync-batch.ts';
import { newId } from '../../src/internal.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 3, 9, minute));
}

async function log(
  target: TestWorkspace,
  kind: 'lead.created' | 'person.updated',
  minute: number,
  personId = 'p1',
) {
  return await withBatch({ principal: target.admin }, async (batch) => ({
    activity: await recordActivity(batch, {
      kind,
      payload: { minute },
      links: [
        { entityType: 'person', entityId: personId },
        { entityType: 'person', entityId: personId },
        { entityType: 'lead', entityId: 'l1' },
      ],
      occurredAt: at(minute),
    }),
  }));
}

describe('recordActivity', () => {
  test('writes deduped links and emits an insert scoped to the linked person', async () => {
    const result = await log(workspace, 'lead.created', 1);
    expect(result.activity.links).toEqual([
      { entityType: 'person', entityId: 'p1' },
      { entityType: 'lead', entityId: 'l1' },
    ]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ model: 'activity', action: 'insert' });
    expect(result.actions[0]?.scopes).toEqual([
      `workspace:${workspace.organizationId}`,
      'person:p1',
    ]);
  });

  test('the emitted data is the activity row the timeline returns', async () => {
    const result = await log(workspace, 'person.updated', 2);
    const page = await listTimeline(workspace.admin, { subjectType: 'person', subjectId: 'p1' });
    expect(result.actions[0]?.data).toEqual(page.activities[0] ?? {});
  });
});

describe('listTimeline', () => {
  test('returns newest first, pages with a cursor and filters by kind', async () => {
    await log(workspace, 'lead.created', 1);
    await log(workspace, 'person.updated', 2);
    await log(workspace, 'lead.created', 3);
    await log(workspace, 'lead.created', 4, 'p2');

    const first = await listTimeline(workspace.admin, {
      subjectType: 'person',
      subjectId: 'p1',
      limit: 2,
    });
    expect(first.activities.map((activity) => activity.payload['minute'])).toEqual([3, 2]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listTimeline(workspace.admin, {
      subjectType: 'person',
      subjectId: 'p1',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.activities.map((activity) => activity.payload['minute'])).toEqual([1]);
    expect(second.nextCursor).toBeNull();

    const notes = await listTimeline(workspace.admin, {
      subjectType: 'person',
      subjectId: 'p1',
      filter: 'notes',
    });
    expect(notes.activities).toHaveLength(0);

    const changes = await listTimeline(workspace.admin, {
      subjectType: 'person',
      subjectId: 'p1',
      filter: 'changes',
    });
    expect(changes.activities).toHaveLength(3);
  });

  test('breaks a tie on the same instant by id without skipping or repeating', async () => {
    await log(workspace, 'lead.created', 7);
    await log(workspace, 'person.updated', 7);
    await log(workspace, 'lead.created', 7);
    const seen: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await listTimeline(workspace.admin, {
        subjectType: 'person',
        subjectId: 'p1',
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.activities.map((activity) => activity.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  test('refuses a malformed cursor with a 422', async () => {
    await expect(
      listTimeline(workspace.admin, { subjectType: 'person', subjectId: 'p1', cursor: '%%%' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test('refuses a well-formed cursor of the wrong shape with a 422', async () => {
    for (const cursor of [
      encodeCursor(['x', 'y']),
      encodeCursor([1, 'y']),
      encodeCursor(['2026-10-03T09:00:00.000Z', 5]),
      encodeCursor(['2026-10-03T09:00:00.000Z', '']),
    ]) {
      await expect(
        listTimeline(workspace.admin, { subjectType: 'person', subjectId: 'p1', cursor }),
      ).rejects.toMatchObject({ status: 422 });
    }
  });

  test('skips and warns about a link with an unknown entity type', async () => {
    await log(workspace, 'lead.created', 1);
    const [activity] = await db.select().from(schema.activity);
    await db.insert(schema.activityLink).values({
      activityId: activity?.id ?? '',
      organizationId: workspace.organizationId,
      entityType: 'bogus',
      entityId: 'z1',
      occurredAt: at(1),
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const page = await listTimeline(workspace.admin, { subjectType: 'person', subjectId: 'p1' });
      expect(page.activities[0]?.links).toEqual([
        { entityType: 'person', entityId: 'p1' },
        { entityType: 'lead', entityId: 'l1' },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(activity?.id ?? 'missing');
    } finally {
      warn.mockRestore();
    }
  });

  test('fails loudly instead of inventing an actor for an unreadable row', async () => {
    const id = newId();
    await db.insert(schema.activity).values({
      id,
      organizationId: workspace.organizationId,
      kind: 'lead.created',
      actor: { nonsense: true },
      occurredAt: at(1),
      payload: {},
      syncId: 1,
    });
    await db.insert(schema.activityLink).values({
      activityId: id,
      organizationId: workspace.organizationId,
      entityType: 'person',
      entityId: 'p1',
      occurredAt: at(1),
    });
    await expect(
      listTimeline(workspace.admin, { subjectType: 'person', subjectId: 'p1' }),
    ).rejects.toMatchObject({ status: 500, message: expect.stringContaining(id) });
  });

  test('never shows another workspace activity for the same entity id', async () => {
    const other = await createWorkspace('Other');
    await log(other, 'lead.created', 5);
    const mine = await listTimeline(workspace.admin, { subjectType: 'person', subjectId: 'p1' });
    expect(mine.activities).toHaveLength(0);
  });
});

describe('diffValues', () => {
  test('lists only the keys whose value changed', () => {
    expect(
      diffValues(
        { name: 'Ada', tags: ['a'], title: null },
        { name: 'Ada', tags: ['a', 'b'], title: 'CTO' },
        ['name', 'tags', 'title'],
      ),
    ).toEqual({
      tags: { from: ['a'], to: ['a', 'b'] },
      title: { from: null, to: 'CTO' },
    });
  });
});
