import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resetDatabase } from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { auth } from '@/lib/auth/server.ts';

const EMAIL_OTP = { method: 'email-otp' };
const NOT_ALLOWED = { body: { code: 'EMAIL_DOMAIN_NOT_ALLOWED' } };

const savedDomains = process.env['ALLOWED_EMAIL_DOMAINS'];

beforeEach(async () => {
  await resetDatabase();
  process.env['ALLOWED_EMAIL_DOMAINS'] = 'acme.com';
});

afterEach(() => {
  if (savedDomains === undefined) delete process.env['ALLOWED_EMAIL_DOMAINS'];
  else process.env['ALLOWED_EMAIL_DOMAINS'] = savedDomains;
});

describe('auth user creation', () => {
  test('refuses a user outside the allowed domains', async () => {
    const context = await auth.$context;
    await expect(
      context.internalAdapter.createUser(
        { email: 'mallory@evil.test', name: 'Mallory' },
        EMAIL_OTP,
      ),
    ).rejects.toMatchObject(NOT_ALLOWED);
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });

  test('creates a user inside the allowed domains with a handle', async () => {
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { email: 'ada@acme.com', name: 'Ada' },
      EMAIL_OTP,
    );
    const [row] = await db.select().from(schema.user);
    expect(row?.id).toBe(user.id);
    expect(row?.handle.length).toBeGreaterThan(0);
  });
});

describe('auth session creation', () => {
  test('refuses a session for a user whose domain is no longer allowed', async () => {
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { email: 'ada@acme.com', name: 'Ada' },
      EMAIL_OTP,
    );
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'other.com';
    await expect(context.internalAdapter.createSession(user.id)).rejects.toMatchObject(NOT_ALLOWED);
    expect(await db.select().from(schema.session)).toHaveLength(0);
  });

  test('creates a session for an allowed user', async () => {
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { email: 'ada@acme.com', name: 'Ada' },
      EMAIL_OTP,
    );
    await context.internalAdapter.createSession(user.id);
    expect(await db.select().from(schema.session)).toHaveLength(1);
  });
});

describe('auth sign in codes', () => {
  test('refuses to send a code to a domain outside the allowlist', async () => {
    await expect(
      auth.api.sendVerificationOTP({ body: { email: 'mallory@evil.test', type: 'sign-in' } }),
    ).rejects.toMatchObject(NOT_ALLOWED);
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });

  test('a code expires in five minutes, matching the email copy', async () => {
    const before = Date.now();
    await auth.api.createVerificationOTP({ body: { email: 'ada@acme.com', type: 'sign-in' } });
    const [row] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, 'sign-in-otp-ada@acme.com'));
    const seconds = ((row?.expiresAt.getTime() ?? 0) - before) / 1000;
    expect(seconds).toBeGreaterThan(295);
    expect(seconds).toBeLessThanOrEqual(301);
  });

  test('a sign in code for an outside domain never creates a user', async () => {
    const otp = await auth.api.createVerificationOTP({
      body: { email: 'mallory@evil.test', type: 'sign-in' },
    });
    await expect(
      auth.api.signInEmailOTP({ body: { email: 'mallory@evil.test', otp } }),
    ).rejects.toMatchObject(NOT_ALLOWED);
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });
});

describe('auth account linking', () => {
  test('never links accounts across different emails', async () => {
    const context = await auth.$context;
    expect(context.options.account?.accountLinking).toEqual({
      enabled: true,
      allowUnlinkingAll: false,
      allowDifferentEmails: false,
    });
  });
});

describe('auth sign in code delivery', () => {
  const savedKey = process.env['RESEND_API_KEY'];

  afterEach(() => {
    if (savedKey === undefined) delete process.env['RESEND_API_KEY'];
    else process.env['RESEND_API_KEY'] = savedKey;
  });

  test('says so when email delivery is not configured instead of reporting success', async () => {
    delete process.env['RESEND_API_KEY'];
    await expect(
      auth.api.sendVerificationOTP({ body: { email: 'ada@acme.com', type: 'sign-in' } }),
    ).rejects.toMatchObject({ body: { code: 'EMAIL_UNAVAILABLE' } });
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });
});
