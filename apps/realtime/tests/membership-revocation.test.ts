import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@gravity/db';
import { ORGANIZATION_FORBIDDEN_CLOSE_CODE, scopes } from '@gravity/shared/events';
import type { Redis } from 'ioredis';
import { createRealtimeServer, type RealtimeServer } from '../src/server.ts';
import {
  cleanupFixtures,
  connectClient,
  createMember,
  createOrganization,
  createPublisher,
  redisUrl,
  syncAction,
} from '../src/test-helpers.ts';

const BATCH_WINDOW_MS = 40;
const DELTA_CHANNEL = 'gravity:delta';

let server: RealtimeServer;
let publisher: Redis;
let organizationId = '';

beforeAll(async () => {
  organizationId = await createOrganization();
  publisher = createPublisher();
  server = await createRealtimeServer({ redisUrl: redisUrl(), batchWindowMs: BATCH_WINDOW_MS });
});

afterAll(async () => {
  await server.close();
  publisher.disconnect();
  await cleanupFixtures();
});

async function publishMemberDelete(userId: string, organization: string): Promise<void> {
  await publisher.publish(
    DELTA_CHANNEL,
    JSON.stringify(
      syncAction({
        organizationId: organization,
        scopes: [scopes.workspace(organization), scopes.user(userId)],
        action: 'delete',
        model: 'member',
        modelId: `member_${userId}`,
        data: { id: `member_${userId}`, userId },
      }),
    ),
  );
}

describe('membership revocation', () => {
  it('closes the socket of a member who was removed', async () => {
    const removed = await createMember({ organizationId });
    const client = await connectClient(server.port, removed, organizationId);
    await client.waitFor('ready');

    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, removed.userId),
        ),
      );
    await publishMemberDelete(removed.userId, organizationId);

    expect(await client.waitForClose()).toBe(ORGANIZATION_FORBIDDEN_CLOSE_CODE);
    expect(server.stats().connections).toBe(0);
  });

  it('keeps a member connected when the removal names someone still in the workspace', async () => {
    const staying = await createMember({ organizationId });
    const client = await connectClient(server.port, staying, organizationId);
    await client.waitFor('ready');

    await publishMemberDelete(staying.userId, organizationId);

    client.send({ type: 'ping' });
    expect(await client.waitFor('pong')).toBeDefined();
    client.close();
  });
});
