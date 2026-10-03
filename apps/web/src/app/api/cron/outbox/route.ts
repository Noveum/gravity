import { timingSafeEqual } from 'node:crypto';
import { republishStale } from '@gravity/core';
import { unauthorized } from '@gravity/shared/errors';
import { handleRoute } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

const STALE_AFTER_MS = 30_000;
const BATCH = 500;

function authorized(request: Request): boolean {
  const secret = process.env['CRON_SECRET'] ?? '';
  if (secret.length === 0) return false;
  const presented = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    if (!authorized(request)) throw unauthorized('A valid cron secret is required.');
    return { published: await republishStale(STALE_AFTER_MS, BATCH) };
  });
}
