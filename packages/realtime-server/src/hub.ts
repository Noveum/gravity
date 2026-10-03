import { randomUUID } from 'node:crypto';
import {
  clientMessageSchema,
  controlMessageSchema,
  DELTA_BATCH_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  PRESENCE_TTL_MS,
  type PresenceKind,
  presenceMessageSchema,
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
  SESSION_REVOKED_CLOSE_CODE,
  type SyncAction,
  syncActionSchema,
  UNAUTHORIZED_CLOSE_CODE,
} from '@gravity/shared/events';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  authenticateTicket,
  authorizeScope,
  type ConnectionRejection,
  liveSessionIds,
  memberDeleteSchema,
  membershipStillValid,
  readTicketFrame,
  refreshedPrincipal,
  sessionStillValid,
} from './auth.ts';
import { Connection, type SocketState } from './connection.ts';
import { errorFields, logger } from './logger.ts';
import { PresenceStore } from './presence.ts';
import { type RealtimeSocket, SOCKET_OPEN } from './socket.ts';

export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 256;
export const MAX_BUFFERED_BYTES = 1_048_576;
export const MESSAGE_BURST = 60;
export const MESSAGES_PER_SECOND = 20;
export const AUTH_TIMEOUT_MS = 10_000;
export const SESSION_SWEEP_INTERVAL_MS = 60_000;

export interface RealtimeHubOptions {
  redisUrl?: string;
  ticketSecret?: string;
  authTimeoutMs?: number;
  batchWindowMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  sessionSweepIntervalMs?: number;
  presenceTtlMs?: number;
  maxSubscriptions?: number;
  maxBufferedBytes?: number;
  messageBurst?: number;
  messagesPerSecond?: number;
}

export interface RealtimeStats {
  connections: number;
  subscriptions: number;
  redis: string;
}

export interface RealtimeSession {
  message(raw: string): void;
  pong(): void;
  closed(): void;
}

export interface RealtimeHub {
  accept(socket: RealtimeSocket): RealtimeSession;
  stats(): RealtimeStats;
  close(): Promise<void>;
}

const deltaEnvelopeSchema = z.union([
  z.array(z.unknown()).min(1),
  z.unknown().transform((action) => [action]),
]);

function presenceWithinReach(
  connection: Connection,
  organizationId: string,
  scope: string,
  userId: string,
): boolean {
  if (connection.principal.userId === userId) return false;
  return connection.matches([scope], organizationId);
}

const CLOSE_CODES: Record<ConnectionRejection, number> = {
  unauthorized: UNAUTHORIZED_CLOSE_CODE,
  organization_forbidden: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
};

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function parseDeltaActions(payload: string): SyncAction[] | null {
  const envelope = deltaEnvelopeSchema.safeParse(parseJson(payload));
  if (!envelope.success) {
    logger.warn('discarded malformed delta', { channel: REDIS_DELTA_CHANNEL });
    return null;
  }
  const actions: SyncAction[] = [];
  for (const entry of envelope.data) {
    const parsed = syncActionSchema.safeParse(entry);
    if (!parsed.success) {
      logger.warn('discarded malformed delta action', { channel: REDIS_DELTA_CHANNEL });
      continue;
    }
    actions.push(parsed.data);
  }
  return actions;
}

export async function createRealtimeHub(options: RealtimeHubOptions = {}): Promise<RealtimeHub> {
  const limits = {
    batchWindowMs: options.batchWindowMs ?? DELTA_BATCH_WINDOW_MS,
    maxSubscriptions: options.maxSubscriptions ?? MAX_SUBSCRIPTIONS_PER_CONNECTION,
    maxBufferedBytes: options.maxBufferedBytes ?? MAX_BUFFERED_BYTES,
    messageBurst: options.messageBurst ?? MESSAGE_BURST,
    messagesPerSecond: options.messagesPerSecond ?? MESSAGES_PER_SECOND,
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const sessionSweepIntervalMs = options.sessionSweepIntervalMs ?? SESSION_SWEEP_INTERVAL_MS;
  const presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6382';
  const ticketSecret = options.ticketSecret ?? process.env['BETTER_AUTH_SECRET'] ?? '';
  if (ticketSecret.length === 0) {
    throw new Error('BETTER_AUTH_SECRET is required to verify realtime tickets.');
  }

  const connections = new Map<string, Connection>();
  const presence = new PresenceStore(presenceTtlMs);
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: 3 });

  function stats(): RealtimeStats {
    let subscriptions = 0;
    for (const connection of connections.values()) subscriptions += connection.subscriptionCount;
    return {
      connections: connections.size,
      subscriptions,
      redis: subscriber.status === 'ready' ? 'ready' : subscriber.status,
    };
  }

  async function revalidate(connection: Connection): Promise<void> {
    let valid = false;
    try {
      valid = await membershipStillValid(connection.principal);
    } catch (error: unknown) {
      logger.error('membership revalidation failed, closing to fail closed', {
        connectionId: connection.id,
        ...errorFields(error),
      });
    }
    if (valid) return;
    logger.info('closing connection for a removed member', {
      connectionId: connection.id,
      userId: connection.principal.userId,
      organizationId: connection.principal.organizationId,
    });
    connections.delete(connection.id);
    connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
  }

  async function revalidateSession(connection: Connection): Promise<void> {
    let valid = false;
    try {
      valid = await sessionStillValid(connection.principal.sessionId);
    } catch (error: unknown) {
      logger.error('session revalidation failed, closing to fail closed', {
        connectionId: connection.id,
        ...errorFields(error),
      });
    }
    if (valid) return;
    closeRevokedSession(connection);
  }

  function closeRevokedSession(connection: Connection): void {
    logger.info('closing connection for a revoked session', {
      connectionId: connection.id,
      userId: connection.principal.userId,
    });
    connections.delete(connection.id);
    connection.close(SESSION_REVOKED_CLOSE_CODE, 'session_revoked');
  }

  async function sweepSessions(): Promise<void> {
    const open = [...connections.values()];
    if (open.length === 0) return;
    const live = await liveSessionIds(open.map((connection) => connection.principal.sessionId));
    for (const connection of open) {
      if (live.has(connection.principal.sessionId)) continue;
      closeRevokedSession(connection);
    }
  }

  function revalidateSessionsFor(userId: string): void {
    for (const connection of connections.values()) {
      if (connection.principal.userId !== userId) continue;
      revalidateSession(connection).catch((error: unknown) => {
        logger.error('session revalidation failed', {
          connectionId: connection.id,
          ...errorFields(error),
        });
      });
    }
  }

  function closeOrganizationConnections(organizationId: string): void {
    for (const connection of connections.values()) {
      if (connection.organizationId !== organizationId) continue;
      connections.delete(connection.id);
      connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'organization_deleted');
    }
  }

  function deliverControl(payload: string): void {
    const parsed = controlMessageSchema.safeParse(parseJson(payload));
    if (!parsed.success) {
      logger.warn('discarded malformed control message', { channel: REDIS_CONTROL_CHANNEL });
      return;
    }
    if (parsed.data.type === 'session_revoked') {
      revalidateSessionsFor(parsed.data.userId);
      return;
    }
    closeOrganizationConnections(parsed.data.organizationId);
  }

  async function revalidateReach(connection: Connection): Promise<void> {
    const next = await refreshedPrincipal(connection.principal);
    if (next === null) {
      connections.delete(connection.id);
      connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
      return;
    }
    connection.adoptPrincipal(next);
    const dropped: string[] = [];
    for (const scope of connection.heldScopes()) {
      if (await authorizeScope(next, scope)) continue;
      dropped.push(scope);
    }
    if (dropped.length === 0) return;
    connection.removeScopes(dropped);
    logger.info('dropped scopes the reader may no longer reach', {
      connectionId: connection.id,
      dropped,
    });
  }

  async function revalidateMembershipReach(action: SyncAction): Promise<void> {
    if (action.model !== 'member' || action.action === 'delete') return;
    const affected = [...connections.values()].filter(
      (connection) => connection.organizationId === action.organizationId,
    );
    await Promise.all(
      affected.map(async (connection) => {
        try {
          await revalidateReach(connection);
        } catch (error: unknown) {
          connections.delete(connection.id);
          connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
          logger.error('reach revalidation failed, closing to fail closed', {
            connectionId: connection.id,
            ...errorFields(error),
          });
        }
      }),
    );
  }

  async function revalidateAffected(action: SyncAction): Promise<void> {
    await revalidateMembershipReach(action);
    if (action.model !== 'member' || action.action !== 'delete') return;
    const removed = memberDeleteSchema.safeParse(action.data);
    if (!removed.success) throw new Error('member removal payload cannot be revalidated');
    const affected = [...connections.values()].filter(
      (connection) =>
        connection.organizationId === action.organizationId &&
        connection.principal.userId === removed.data.userId,
    );
    await Promise.all(
      affected.map(async (connection) => {
        try {
          await revalidate(connection);
        } catch (error: unknown) {
          connections.delete(connection.id);
          connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
          logger.error('membership revalidation failed', {
            connectionId: connection.id,
            ...errorFields(error),
          });
        }
      }),
    );
  }

  function suspendMembershipDeltaFlush(action: SyncAction): Connection[] {
    if (action.model !== 'member') return [];
    const affected = [...connections.values()].filter(
      (connection) => connection.organizationId === action.organizationId,
    );
    for (const connection of affected) {
      connection.suspendDeltaFlush();
      connection.suspendAuthorization();
    }
    return affected;
  }

  function finishMembershipDeltaFlush(
    action: SyncAction,
    affected: readonly Connection[],
    revalidated: boolean,
  ): void {
    if (affected.length === 0) return;
    for (const connection of affected) {
      if (connections.get(connection.id) !== connection) {
        connection.resumeAuthorization();
        continue;
      }
      if (!revalidated) {
        connections.delete(connection.id);
        connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
        connection.resumeAuthorization();
        continue;
      }
      connection.resumeDeltaFlush((pending) =>
        connection.matches(pending.scopes, pending.organizationId),
      );
      connection.resumeAuthorization();
    }
    if (revalidated) return;
    logger.error('membership delta processing failed, closing to fail closed', {
      organizationId: action.organizationId,
    });
  }

  function queueAction(action: SyncAction): void {
    for (const connection of connections.values()) {
      if (connection.matches(action.scopes, action.organizationId)) connection.queueDelta(action);
    }
  }

  async function deliverDelta(payload: string): Promise<void> {
    const actions = parseDeltaActions(payload);
    if (actions === null) return;
    for (const action of actions) {
      const membershipAffected = suspendMembershipDeltaFlush(action);
      let revalidated = false;
      try {
        queueAction(action);
        await revalidateAffected(action);
        revalidated = true;
      } catch (error: unknown) {
        logger.error('delta action processing failed', {
          organizationId: action.organizationId,
          model: action.model,
          modelId: action.modelId,
          ...errorFields(error),
        });
      } finally {
        finishMembershipDeltaFlush(action, membershipAffected, revalidated);
      }
    }
  }

  function deliverPresence(payload: string): void {
    const parsed = presenceMessageSchema.safeParse(parseJson(payload));
    if (!parsed.success) {
      logger.warn('discarded malformed presence', { channel: REDIS_PRESENCE_CHANNEL });
      return;
    }
    const message = parsed.data;
    if (!presence.record(message)) return;
    for (const connection of connections.values()) {
      if (!presenceWithinReach(connection, message.organizationId, message.scope, message.userId)) {
        continue;
      }
      connection.send({ type: 'presence', messages: [message] });
    }
  }

  async function partitionScopes(
    connection: Connection,
    requested: readonly string[],
  ): Promise<{ accepted: string[]; denied: string[] }> {
    const accepted: string[] = [];
    const denied: string[] = [];
    for (const scope of requested) {
      if (connection.scopes.has(scope)) {
        accepted.push(scope);
        continue;
      }
      if (await authorizeScope(connection.principal, scope)) accepted.push(scope);
      else denied.push(scope);
    }
    return { accepted, denied };
  }

  function sendSubscriptionResult(
    connection: Connection,
    accepted: readonly string[],
    denied: readonly string[],
  ): void {
    const overflow = connection.addScopes(accepted);
    connection.send({
      type: 'subscribed',
      scopes: [...connection.scopes],
      denied: [...denied, ...overflow],
    });
    for (const scope of accepted) {
      if (!connection.scopes.has(scope)) continue;
      const messages = presence
        .snapshot(scope)
        .filter((message) => message.userId !== connection.principal.userId);
      if (messages.length > 0) connection.send({ type: 'presence', messages });
    }
  }

  async function handleSubscribe(connection: Connection, requested: string[]): Promise<void> {
    while (connections.get(connection.id) === connection) {
      const generation = await connection.waitForAuthorization();
      if (connections.get(connection.id) !== connection) return;
      const { accepted, denied } = await partitionScopes(connection, requested);
      if (connections.get(connection.id) !== connection) return;
      if (!connection.authorizationIsCurrent(generation)) continue;
      sendSubscriptionResult(connection, accepted, denied);
      return;
    }
  }

  interface PresenceAuthorization {
    readonly allowed: boolean;
    readonly held: boolean;
  }

  async function authorizePresence(
    connection: Connection,
    scope: string,
  ): Promise<PresenceAuthorization> {
    const held = connection.scopes.has(scope);
    const allowed = held || (await authorizeScope(connection.principal, scope));
    return { allowed, held };
  }

  async function publishPresence(
    connection: Connection,
    scope: string,
    kind: PresenceKind,
  ): Promise<void> {
    await publisher.publish(
      REDIS_PRESENCE_CHANNEL,
      JSON.stringify({
        organizationId: connection.organizationId,
        scope,
        kind,
        userId: connection.principal.userId,
        name: connection.principal.name,
        image: connection.principal.image,
        at: new Date().toISOString(),
      }),
    );
  }

  async function handlePresence(
    connection: Connection,
    scope: string,
    kind: PresenceKind,
  ): Promise<void> {
    while (connections.get(connection.id) === connection) {
      const generation = await connection.waitForAuthorization();
      if (connections.get(connection.id) !== connection) return;
      const authorization = await authorizePresence(connection, scope);
      if (connections.get(connection.id) !== connection) return;
      if (!connection.authorizationIsCurrent(generation)) continue;
      if (!authorization.allowed) {
        if (authorization.held) connection.removeScopes([scope]);
        connection.send({ type: 'error', code: 'forbidden_scope', message: 'Scope not allowed.' });
        return;
      }
      await publishPresence(connection, scope, kind);
      return;
    }
  }

  async function handleMessage(connection: Connection, raw: string): Promise<void> {
    connection.lastSeenAt = Date.now();
    if (!connection.takeToken()) {
      if (connection.announceThrottled()) {
        connection.send({
          type: 'error',
          code: 'rate_limited',
          message: 'Too many messages, slow down.',
        });
      }
      return;
    }
    connection.clearThrottle();
    const parsed = clientMessageSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      connection.send({
        type: 'error',
        code: 'invalid_message',
        message: 'Message did not match the client protocol.',
      });
      return;
    }
    const message = parsed.data;
    if (message.type === 'ping') {
      connection.send({ type: 'pong', at: new Date().toISOString() });
      return;
    }
    if (message.type === 'unsubscribe') {
      connection.removeScopes(message.scopes);
      connection.send({ type: 'subscribed', scopes: [...connection.scopes], denied: [] });
      return;
    }
    if (message.type === 'subscribe') {
      await handleSubscribe(connection, message.scopes);
      return;
    }
    await handlePresence(connection, message.scope, message.kind);
  }

  function clearAuthTimer(state: SocketState): void {
    if (state.authTimer !== undefined) {
      clearTimeout(state.authTimer);
      state.authTimer = undefined;
    }
  }

  async function authenticate(
    socket: RealtimeSocket,
    state: SocketState,
    raw: string,
  ): Promise<void> {
    if (state.connection !== null || state.authenticating) return;
    const payload = readTicketFrame(raw, ticketSecret);
    if (payload === null) {
      socket.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
      return;
    }
    state.authenticating = true;
    const authenticated = await authenticateTicket(payload);
    if (socket.readyState !== SOCKET_OPEN) return;
    if (!authenticated.ok) {
      socket.close(CLOSE_CODES[authenticated.reason], authenticated.reason);
      return;
    }
    clearAuthTimer(state);
    const connection = new Connection(randomUUID(), socket, authenticated.principal, limits);
    state.connection = connection;
    connections.set(connection.id, connection);
    connection.send({
      type: 'ready',
      connectionId: connection.id,
      userId: authenticated.principal.userId,
      organizationId: authenticated.principal.organizationId,
      scopes: [],
    });
    logger.info('connection ready', {
      connectionId: connection.id,
      userId: authenticated.principal.userId,
      organizationId: authenticated.principal.organizationId,
    });
  }

  function accept(socket: RealtimeSocket): RealtimeSession {
    const state: SocketState = { connection: null, authenticating: false, authTimer: undefined };
    state.authTimer = setTimeout(() => {
      state.authTimer = undefined;
      if (state.connection === null) socket.close(UNAUTHORIZED_CLOSE_CODE, 'auth_timeout');
    }, authTimeoutMs);
    state.authTimer.unref();

    return {
      message(raw: string): void {
        const connection = state.connection;
        if (connection === null) {
          authenticate(socket, state, raw).catch((error: unknown) => {
            logger.error('authentication failed', errorFields(error));
            if (socket.readyState === SOCKET_OPEN) {
              socket.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
            }
          });
          return;
        }
        handleMessage(connection, raw).catch((error: unknown) => {
          logger.error('message handling failed', {
            connectionId: connection.id,
            ...errorFields(error),
          });
        });
      },
      pong(): void {
        if (state.connection === null) return;
        state.connection.lastSeenAt = Date.now();
      },
      closed(): void {
        clearAuthTimer(state);
        if (state.connection === null) return;
        connections.delete(state.connection.id);
      },
    };
  }

  let closing = false;
  let orderedDelivery = Promise.resolve();

  subscriber.on('message', (channel: string, message: string) => {
    if (channel === REDIS_DELTA_CHANNEL || channel === REDIS_PRESENCE_CHANNEL) {
      orderedDelivery = orderedDelivery
        .then(async () => {
          if (channel === REDIS_DELTA_CHANNEL) await deliverDelta(message);
          else deliverPresence(message);
        })
        .catch((error: unknown) => {
          logger.error('ordered realtime delivery failed', errorFields(error));
        });
      return;
    }
    if (channel === REDIS_CONTROL_CHANNEL) deliverControl(message);
  });
  await subscriber.subscribe(REDIS_DELTA_CHANNEL, REDIS_PRESENCE_CHANNEL, REDIS_CONTROL_CHANNEL);

  subscriber.on('error', (error: Error): void => {
    if (!closing) logger.error('redis subscriber error', errorFields(error));
  });

  let subscriberInterrupted = false;
  subscriber.on('close', (): void => {
    if (!closing) subscriberInterrupted = true;
  });
  subscriber.on('ready', (): void => {
    if (!subscriberInterrupted || closing) return;
    subscriberInterrupted = false;
    logger.info('redis subscriber recovered, asking every connection to catch up', {
      connections: connections.size,
    });
    for (const connection of connections.values()) connection.send({ type: 'resync' });
  });
  publisher.on('error', (error: Error): void => {
    if (!closing) logger.error('redis publisher error', errorFields(error));
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (now - connection.lastSeenAt > heartbeatTimeoutMs) {
        logger.warn('terminating stale connection', { connectionId: connection.id });
        connections.delete(connection.id);
        connection.terminate();
        continue;
      }
      connection.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  const sweeper = setInterval(() => presence.sweep(), Math.max(1_000, presenceTtlMs / 3));
  sweeper.unref();

  const sessionSweeper = setInterval(() => {
    sweepSessions().catch((error: unknown) => {
      logger.error('session sweep failed', errorFields(error));
    });
  }, sessionSweepIntervalMs);
  sessionSweeper.unref();

  async function close(): Promise<void> {
    closing = true;
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(sessionSweeper);
    for (const connection of connections.values()) connection.close(1001, 'server shutting down');
    connections.clear();
    subscriber.disconnect();
    publisher.disconnect();
    await orderedDelivery;
  }

  return { accept, stats, close };
}
