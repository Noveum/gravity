import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { db, schema, sql } from '@gravity/db';
import {
  assertEmailConfigured,
  createEmailTransport,
  type EmailTransport,
  sendEmail,
} from '../../src/email/index.ts';

beforeEach(async () => {
  await db.execute(sql`truncate table email_delivery`);
});

describe('sendEmail', () => {
  test('sends once per idempotency key', async () => {
    const send = mock(() => Promise.resolve({ providerId: 'provider-1' }));
    const transport: EmailTransport = { send };
    const input = {
      to: 'ada@acme.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      template: 'sign-in-code',
      idempotencyKey: 'k-1',
    };
    await sendEmail(db, input, transport);
    await sendEmail(db, input, transport);
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(schema.emailDelivery);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.providerId).toBe('provider-1');
  });

  test('records a failed delivery and rethrows', async () => {
    const send = mock(() => Promise.reject(new Error('provider down')));
    const transport: EmailTransport = { send };
    const input = {
      to: 'ada@acme.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      template: 'invite',
      idempotencyKey: 'k-2',
    };
    await expect(sendEmail(db, input, transport)).rejects.toThrow();
    const rows = await db.select().from(schema.emailDelivery);
    expect(rows[0]?.status).toBe('failed');
  });
});

describe('email configuration', () => {
  test('assertEmailConfigured refuses a missing key and a local sender', () => {
    expect(() => assertEmailConfigured({})).toThrow();
    expect(() =>
      assertEmailConfigured({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'Gravity <auth@gravity.local>' }),
    ).toThrow();
  });

  test('assertEmailConfigured accepts a key with a verified sender domain', () => {
    expect(() =>
      assertEmailConfigured({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'Gravity <auth@gravity.dev>' }),
    ).not.toThrow();
  });

  test('createEmailTransport refuses to build without a key', () => {
    expect(() => createEmailTransport({})).toThrow();
  });
});
