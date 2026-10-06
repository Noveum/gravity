import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { and, db, eq, schema } from '@gravity/db';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
  SESSION_REVOKED_CLOSE_CODE,
  type SyncAction,
  UNAUTHORIZED_CLOSE_CODE,
} from '@gravity/shared/events';
import { signRealtimeTicket } from '@gravity/shared/events/ticket';
import { FakeRedis, liveFakeRedis, resetFakeRedis } from './fake-redis.ts';
import { FakeSocket, waitFor } from './fake-socket.ts';
import {
  dropSeededWorkspaces,
  insertSession,
  type SeededWorkspace,
  seedWorkspace,
} from './fixture.ts';

mock.module('ioredis', () => ({ Redis: FakeRedis }));

const { createRealtimeHub } = await import('../src/hub.ts');
type Hub = Awaited<ReturnType<typeof createRealtimeHub>>;

const SECRET = 'a-secret-long-enough-for-the-ticket';
const REDIS_URL = 'redis://fake:6379';

let home: SeededWorkspace;
let away: SeededWorkspace;

beforeAll(async () => {
  home = await seedWorkspace('Hub home');
  away = await seedWorkspace('Hub away');
});

afterAll(async () => {
  await dropSeededWorkspaces();
  resetFakeRedis();
});

async function newHub(overrides: Parameters<typeof createRealtimeHub>[0] = {}): Promise<Hub> {
  return await createRealtimeHub({
    redisUrl: REDIS_URL,
    ticketSecret: SECRET,
    batchWindowMs: 1,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 60_000,
    ...overrides,
  });
}

interface Wired {
  readonly socket: FakeSocket;
  readonly session: ReturnType<Hub['accept']>;
  readonly sessionId: string;
}

async function connect(hub: Hub, userId: string, organizationId: string): Promise<Wired> {
  const { sessionId } = await insertSession(userId, new Date(Date.now() + 600_000));
  const socket = new FakeSocket();
  const session = hub.accept(socket);
  const ticket = signRealtimeTicket(
    { userId, organizationId, sessionId, exp: Date.now() + 60_000 },
    SECRET,
  );
  session.message(JSON.stringify({ type: 'auth', ticket }));
  await waitFor(() => socket.last('ready') !== undefined, `a ready frame for ${userId}`);
  return { socket, session, sessionId };
}

async function subscribe(wired: Wired, scopes: readonly string[]): Promise<void> {
  const before = wired.socket.frames('subscribed').length;
  wired.session.message(JSON.stringify({ type: 'subscribe', scopes }));
  await waitFor(
    () => wired.socket.frames('subscribed').length > before,
    `a subscribed frame for ${scopes.join()}`,
  );
}

function workspace(organization: SeededWorkspace): string {
  return `workspace:${organization.organizationId}`;
}

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 10,
    organizationId: home.organizationId,
    scopes: [workspace(home)],
    action: 'update',
    model: 'person',
    modelId: 'person_1',
    data: { id: 'person_1', name: 'Grace' },
    actor: { type: 'user', id: home.adminUserId },
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function memberRemoval(userId: string, syncId: number): SyncAction {
  return action({
    model: 'member',
    action: 'delete',
    modelId: 'member_row',
    data: { id: 'member_row', userId },
    syncId,
  });
}

function driver(): FakeRedis {
  return new FakeRedis(REDIS_URL);
}

async function publishDelta(entry: SyncAction): Promise<void> {
  await driver().publish(REDIS_DELTA_CHANNEL, JSON.stringify([entry]));
}

async function publishDeltas(entries: readonly SyncAction[]): Promise<void> {
  await driver().publish(REDIS_DELTA_CHANNEL, JSON.stringify(entries));
}

async function removeMember(userId: string): Promise<void> {
  await db
    .delete(schema.member)
    .where(
      and(eq(schema.member.organizationId, home.organizationId), eq(schema.member.userId, userId)),
    );
}

async function restoreMember(userId: string): Promise<void> {
  await db
    .insert(schema.member)
    .values({
      id: `mem_restored_${userId.slice(-8)}`,
      organizationId: home.organizationId,
      userId,
      role: 'member',
    })
    .onConflictDoNothing();
}

describe('subscribe is the authorization gate', () => {
  it('accepts the scopes the principal may reach and returns the rest as denied', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);

      await subscribe(wired, [
        workspace(home),
        `user:${home.readerUserId}`,
        workspace(away),
        `user:${home.adminUserId}`,
        'brand:brand_1',
        'team:legacy',
      ]);

      const frame = wired.socket.last('subscribed');
      expect(frame?.scopes.sort()).toEqual([workspace(home), `user:${home.readerUserId}`].sort());
      expect(frame?.denied.sort()).toEqual(
        [workspace(away), `user:${home.adminUserId}`, 'brand:brand_1', 'team:legacy'].sort(),
      );
      expect(hub.stats().subscriptions).toBe(2);
    } finally {
      await hub.close();
    }
  });

  it('never delivers a delta on a scope it denied', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`user:${home.adminUserId}`]);

      await publishDelta(action({ scopes: [`user:${home.adminUserId}`] }));
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(wired.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('rejects a forged ticket without ever opening a connection', async () => {
    const hub = await newHub();
    try {
      const socket = new FakeSocket();
      const session = hub.accept(socket);
      session.message(JSON.stringify({ type: 'auth', ticket: 'forged.value' }));
      await waitFor(() => socket.closures.length > 0, 'a close after a forged ticket');

      expect(socket.closures[0]?.code).toBe(UNAUTHORIZED_CLOSE_CODE);
      expect(hub.stats().connections).toBe(0);
    } finally {
      await hub.close();
    }
  });

  it('refuses a ticket for a workspace the user is not a member of', async () => {
    const hub = await newHub();
    try {
      const { sessionId } = await insertSession(home.readerUserId, new Date(Date.now() + 600_000));
      const socket = new FakeSocket();
      const session = hub.accept(socket);
      const ticket = signRealtimeTicket(
        {
          userId: home.readerUserId,
          organizationId: away.organizationId,
          sessionId,
          exp: Date.now() + 60_000,
        },
        SECRET,
      );
      session.message(JSON.stringify({ type: 'auth', ticket }));
      await waitFor(() => socket.closures.length > 0, 'a close for a foreign workspace');

      expect(socket.closures[0]?.code).toBe(ORGANIZATION_FORBIDDEN_CLOSE_CODE);
      expect(hub.stats().connections).toBe(0);
    } finally {
      await hub.close();
    }
  });
});

describe('delta fan out', () => {
  it('reaches only the connections whose scopes and workspace both match', async () => {
    const hub = await newHub();
    try {
      const reader = await connect(hub, home.readerUserId, home.organizationId);
      const admin = await connect(hub, home.adminUserId, home.organizationId);
      const elsewhere = await connect(hub, away.readerUserId, away.organizationId);

      await subscribe(reader, [workspace(home)]);
      await subscribe(admin, [`user:${home.adminUserId}`]);
      await subscribe(elsewhere, [workspace(away)]);

      await publishDelta(action());
      await waitFor(() => reader.socket.frames('delta').length > 0, 'a delta on the workspace');
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(reader.socket.last('delta')?.actions[0]?.modelId).toBe('person_1');
      expect(admin.socket.frames('delta')).toHaveLength(0);
      expect(elsewhere.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('keeps a matching scope from crossing into another workspace', async () => {
    const hub = await newHub();
    try {
      const elsewhere = await connect(hub, away.readerUserId, away.organizationId);
      await subscribe(elsewhere, [workspace(away)]);

      await publishDelta(
        action({ organizationId: home.organizationId, scopes: [workspace(away)] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(elsewhere.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('delivers a member role change to the other members of the workspace', async () => {
    const hub = await newHub();
    try {
      const reader = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(reader, [workspace(home), `user:${home.readerUserId}`]);

      await publishDelta(
        action({
          model: 'member',
          modelId: 'member_stranger',
          scopes: [workspace(home), `user:${home.strangerUserId}`],
          data: { id: 'member_stranger', userId: home.strangerUserId, role: 'contributor' },
          syncId: 20,
        }),
      );
      await waitFor(() => reader.socket.frames('delta').length > 0, 'the member delta');

      const delivered = reader.socket.last('delta')?.actions[0];
      expect(delivered?.model).toBe('member');
      expect(delivered?.data['role']).toBe('contributor');
      expect(reader.socket.closures).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('delivers a lower sync id that is published after a higher one', async () => {
    const hub = await newHub();
    try {
      const reader = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(reader, [workspace(home)]);

      await publishDelta(action({ modelId: 'person_b', syncId: 21 }));
      await waitFor(() => reader.socket.frames('delta').length > 0, 'the first delta');
      reader.session.message(JSON.stringify({ type: 'subscribe', scopes: [], since: 21 }));
      await publishDelta(action({ modelId: 'person_a', syncId: 20 }));
      await waitFor(() => reader.socket.frames('delta').length > 1, 'the late lower delta');

      expect(reader.socket.last('delta')?.actions.map((entry) => entry.syncId)).toEqual([20]);
    } finally {
      await hub.close();
    }
  });

  it('discards a delta that does not parse rather than dropping the connection', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [workspace(home)]);

      await driver().publish(REDIS_DELTA_CHANNEL, 'not json');
      await driver().publish(REDIS_DELTA_CHANNEL, JSON.stringify([{ model: 'nope' }]));
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wired.socket.frames('delta')).toHaveLength(0);
      expect(wired.socket.closures).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });
});

describe('redis subscriber recovery', () => {
  function hubSubscriber(): FakeRedis {
    const subscriber = liveFakeRedis().find(
      (instance) => instance.options['maxRetriesPerRequest'] === null,
    );
    if (subscriber === undefined) throw new Error('the hub never created a subscriber');
    return subscriber;
  }

  it('asks every open connection to catch up once the subscriber is ready again', async () => {
    const hub = await newHub();
    try {
      const reader = await connect(hub, home.readerUserId, home.organizationId);
      const visitor = await connect(hub, away.readerUserId, away.organizationId);

      hubSubscriber().dropAndRecover();

      expect(reader.socket.frames('resync')).toHaveLength(1);
      expect(visitor.socket.frames('resync')).toHaveLength(1);
      expect(reader.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(2);
    } finally {
      await hub.close();
    }
  });

  it('sends nothing on a ready that did not follow a lost connection', async () => {
    const hub = await newHub();
    try {
      const reader = await connect(hub, home.readerUserId, home.organizationId);

      hubSubscriber().emit('ready');

      expect(reader.socket.frames('resync')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });
});

describe('presence', () => {
  it('reaches the other reader on the scope and never echoes to its author', async () => {
    const hub = await newHub();
    try {
      const author = await connect(hub, home.readerUserId, home.organizationId);
      const watcher = await connect(hub, home.adminUserId, home.organizationId);
      const bystander = await connect(hub, home.strangerUserId, home.organizationId);
      const elsewhere = await connect(hub, away.readerUserId, away.organizationId);
      await subscribe(author, [workspace(home)]);
      await subscribe(watcher, [workspace(home)]);
      await subscribe(bystander, [`user:${home.strangerUserId}`]);
      await subscribe(elsewhere, [workspace(away)]);

      author.session.message(
        JSON.stringify({ type: 'presence', scope: workspace(home), kind: 'viewing' }),
      );
      await waitFor(
        () => watcher.socket.frames('presence').length > 0,
        'presence to reach the watcher',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(watcher.socket.last('presence')?.messages[0]?.userId).toBe(home.readerUserId);
      expect(author.socket.frames('presence')).toHaveLength(0);
      expect(bystander.socket.frames('presence')).toHaveLength(0);
      expect(elsewhere.socket.frames('presence')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('refuses presence on a scope the principal may not reach', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);

      wired.session.message(
        JSON.stringify({ type: 'presence', scope: workspace(away), kind: 'typing' }),
      );
      await waitFor(() => wired.socket.frames('error').length > 0, 'a forbidden scope error');

      expect(wired.socket.last('error')?.code).toBe('forbidden_scope');
    } finally {
      await hub.close();
    }
  });
});

describe('connection limits', () => {
  it('announces throttling once and drops the excess messages', async () => {
    const hub = await newHub({ messageBurst: 2, messagesPerSecond: 0.001 });
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      for (let index = 0; index < 5; index += 1) {
        wired.session.message(JSON.stringify({ type: 'ping' }));
      }
      await waitFor(() => wired.socket.frames('error').length > 0, 'a rate limit error');
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(wired.socket.frames('pong')).toHaveLength(2);
      expect(wired.socket.frames('error').map((frame) => frame.code)).toEqual(['rate_limited']);
    } finally {
      await hub.close();
    }
  });

  it('closes a socket that never authenticates', async () => {
    const hub = await newHub({ authTimeoutMs: 20 });
    try {
      const socket = new FakeSocket();
      hub.accept(socket);
      await waitFor(() => socket.closures.length > 0, 'the auth timeout');

      expect(socket.closures[0]).toEqual({ code: UNAUTHORIZED_CLOSE_CODE, reason: 'auth_timeout' });
    } finally {
      await hub.close();
    }
  });
});

describe('membership and session revocation', () => {
  it('closes affected connections when a member removal cannot be revalidated', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      const unaffected = await connect(hub, away.readerUserId, away.organizationId);
      await subscribe(wired, [workspace(home)]);
      await subscribe(unaffected, [workspace(away)]);

      await publishDeltas([
        action({
          model: 'member',
          action: 'delete',
          modelId: 'malformed_member_row',
          data: {},
          syncId: 60,
        }),
        action({
          organizationId: away.organizationId,
          scopes: [workspace(away)],
          data: { id: 'person_1', name: 'Delivered after malformed removal' },
          syncId: 61,
        }),
      ]);
      await waitFor(
        () => wired.socket.closures.length > 0,
        'the malformed removal connection closure',
      );

      expect(wired.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'membership_revoked',
      });
      await waitFor(
        () =>
          JSON.stringify(unaffected.socket.frames('delta')).includes(
            'Delivered after malformed removal',
          ),
        'the unaffected action after the malformed removal',
      );
    } finally {
      await hub.close();
    }
  });

  it('closes the connections of a removed member with the workspace forbidden code', async () => {
    const hub = await newHub();
    try {
      const removed = await connect(hub, home.strangerUserId, home.organizationId);
      const kept = await connect(hub, home.readerUserId, home.organizationId);
      await removeMember(home.strangerUserId);

      await publishDelta(memberRemoval(home.strangerUserId, 65));
      await waitFor(() => removed.socket.closures.length > 0, 'the removed member to be closed');

      expect(removed.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'membership_revoked',
      });
      expect(kept.socket.closures).toHaveLength(0);
    } finally {
      await restoreMember(home.strangerUserId);
      await hub.close();
    }
  });

  it('blocks workspace data later in the member removal envelope', async () => {
    const hub = await newHub();
    try {
      const removed = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(removed, [workspace(home)]);
      await removeMember(home.strangerUserId);

      await publishDeltas([
        memberRemoval(home.strangerUserId, 70),
        action({ data: { id: 'person_1', name: 'Restricted after removal' }, syncId: 71 }),
      ]);
      await waitFor(() => removed.socket.closures.length > 0, 'the removed member to be closed');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(JSON.stringify(removed.socket.frames('delta'))).not.toContain(
        'Restricted after removal',
      );
    } finally {
      await restoreMember(home.strangerUserId);
      await hub.close();
    }
  });

  it('drops workspace data already pending when the member removal arrives', async () => {
    const hub = await newHub({ batchWindowMs: 100 });
    try {
      const removed = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(removed, [workspace(home)]);
      await removeMember(home.strangerUserId);

      await publishDelta(
        action({ data: { id: 'person_1', name: 'Restricted while pending' }, syncId: 90 }),
      );
      await publishDelta(memberRemoval(home.strangerUserId, 91));
      await waitFor(() => removed.socket.closures.length > 0, 'the removed member to be closed');
      await new Promise((resolve) => setTimeout(resolve, 130));

      expect(JSON.stringify(removed.socket.frames('delta'))).not.toContain(
        'Restricted while pending',
      );
    } finally {
      await restoreMember(home.strangerUserId);
      await hub.close();
    }
  });

  it('closes a connection whose membership vanished when a member update arrives', async () => {
    const hub = await newHub();
    try {
      const vanished = await connect(hub, home.strangerUserId, home.organizationId);
      const kept = await connect(hub, home.readerUserId, home.organizationId);
      await removeMember(home.strangerUserId);

      await publishDelta(
        action({
          model: 'member',
          modelId: 'member_reader',
          data: { id: 'member_reader', userId: home.readerUserId, role: 'guest' },
          syncId: 95,
        }),
      );
      await waitFor(() => vanished.socket.closures.length > 0, 'the vanished member to close');

      expect(vanished.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'membership_revoked',
      });
      expect(kept.socket.closures).toHaveLength(0);
    } finally {
      await restoreMember(home.strangerUserId);
      await hub.close();
    }
  });

  it('blocks presence delivered after a member removal starts revalidation', async () => {
    const hub = await newHub();
    try {
      const removed = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(removed, [workspace(home)]);
      await removeMember(home.strangerUserId);

      await publishDelta(memberRemoval(home.strangerUserId, 100));
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          organizationId: home.organizationId,
          scope: workspace(home),
          kind: 'viewing',
          userId: home.adminUserId,
          name: 'Ada Admin',
          image: null,
          at: new Date().toISOString(),
        }),
      );
      await waitFor(() => removed.socket.closures.length > 0, 'the removed member to be closed');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(removed.socket.frames('presence')).toHaveLength(0);
    } finally {
      await restoreMember(home.strangerUserId);
      await hub.close();
    }
  });

  it('closes only the revoked session when a control message names its user', async () => {
    const hub = await newHub();
    try {
      const revoked = await connect(hub, home.readerUserId, home.organizationId);
      const other = await connect(hub, home.adminUserId, home.organizationId);
      await db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.session.id, revoked.sessionId));
      await db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.session.id, other.sessionId));

      await driver().publish(
        REDIS_CONTROL_CHANNEL,
        JSON.stringify({ type: 'session_revoked', userId: home.readerUserId }),
      );
      await waitFor(() => revoked.socket.closures.length > 0, 'the revoked session to be closed');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(revoked.socket.closures[0]).toEqual({
        code: SESSION_REVOKED_CLOSE_CODE,
        reason: 'session_revoked',
      });
      expect(other.socket.closures).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('leaves a live session alone when the control message arrives', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);

      await driver().publish(
        REDIS_CONTROL_CHANNEL,
        JSON.stringify({ type: 'session_revoked', userId: home.readerUserId }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(wired.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
    } finally {
      await hub.close();
    }
  });

  it('closes only connections attached to a deleted workspace', async () => {
    const hub = await newHub();
    try {
      const deletedAdmin = await connect(hub, home.adminUserId, home.organizationId);
      const deletedReader = await connect(hub, home.readerUserId, home.organizationId);
      const retained = await connect(hub, away.adminUserId, away.organizationId);

      await driver().publish(
        REDIS_CONTROL_CHANNEL,
        JSON.stringify({
          type: 'organization_deleted',
          organizationId: home.organizationId,
        }),
      );
      await waitFor(
        () => deletedAdmin.socket.closures.length > 0 && deletedReader.socket.closures.length > 0,
        'the deleted workspace connections to be closed',
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(deletedAdmin.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'organization_deleted',
      });
      expect(deletedReader.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'organization_deleted',
      });
      expect(retained.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
    } finally {
      await hub.close();
    }
  });
});

describe('the periodic session sweep closes what no control message ever announced', () => {
  it('closes a connection whose session quietly expired and spares the rest', async () => {
    const hub = await newHub({ sessionSweepIntervalMs: 25 });
    try {
      const stale = await connect(hub, home.readerUserId, home.organizationId);
      const fresh = await connect(hub, home.adminUserId, home.organizationId);
      expect(hub.stats().connections).toBe(2);

      await db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.session.id, stale.sessionId));

      await waitFor(() => stale.socket.closures.length > 0, 'the expired session to be swept');

      expect(stale.socket.closures[0]).toEqual({
        code: SESSION_REVOKED_CLOSE_CODE,
        reason: 'session_revoked',
      });
      expect(fresh.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
    } finally {
      await hub.close();
    }
  });

  it('closes a connection whose session row was deleted outright', async () => {
    const hub = await newHub({ sessionSweepIntervalMs: 25 });
    try {
      const signedOut = await connect(hub, home.readerUserId, home.organizationId);

      await db.delete(schema.session).where(eq(schema.session.id, signedOut.sessionId));

      await waitFor(() => signedOut.socket.closures.length > 0, 'the deleted session to be swept');

      expect(signedOut.socket.closures[0]?.code).toBe(SESSION_REVOKED_CLOSE_CODE);
      expect(hub.stats().connections).toBe(0);
    } finally {
      await hub.close();
    }
  });

  it('leaves a connection whose session is still live alone across many sweeps', async () => {
    const hub = await newHub({ sessionSweepIntervalMs: 10 });
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [workspace(home)]);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(wired.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await hub.close();
    }
  });
});
