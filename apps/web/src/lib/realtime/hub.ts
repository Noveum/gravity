import { createRealtimeHub, type RealtimeHub } from '@gravity/realtime-server';

const globalForHub = globalThis as unknown as {
  gravityRealtimeHub?: Promise<RealtimeHub> | undefined;
};

export function realtimeHub(): Promise<RealtimeHub> {
  const existing = globalForHub.gravityRealtimeHub;
  if (existing !== undefined) return existing;
  const created = createRealtimeHub().catch((error: unknown) => {
    if (globalForHub.gravityRealtimeHub === created) globalForHub.gravityRealtimeHub = undefined;
    throw error;
  });
  globalForHub.gravityRealtimeHub = created;
  return created;
}

export function redisConfigured(): boolean {
  const url = process.env['REDIS_URL'];
  return url !== undefined && url.length > 0;
}
