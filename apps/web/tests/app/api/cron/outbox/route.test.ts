import { beforeEach, describe, expect, test } from 'bun:test';
import { resetDatabase } from '@gravity/core/test-support';
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
    expect(await response.json()).toEqual({ published: 0 });
  });
});
