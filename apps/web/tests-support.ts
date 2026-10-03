import { afterAll, mock } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import * as nextHeaders from 'next/headers';
import { DEV_LOGIN_HEADER } from '@/lib/api/dev-login.ts';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import * as principalModule from '@/lib/auth/principal.ts';
import { auth } from '@/lib/auth/server.ts';
import * as sessionModule from '@/lib/auth/session.ts';

export const SESSION_MODULE = '@/lib/auth/session.ts';
export const PRINCIPAL_MODULE = '@/lib/auth/principal.ts';

const realSession = { ...sessionModule };
const realPrincipal = { ...principalModule };

export function mockSession<T>(read: () => T | null): void {
  mock.module(SESSION_MODULE, () => ({
    ...realSession,
    getSession: () => Promise.resolve(read()),
    requireSession: () => Promise.resolve(read()),
  }));
  afterAll(() => {
    mock.module(SESSION_MODULE, () => realSession);
  });
}

export function mockMembership(read: () => MembershipContext | null): void {
  mock.module(PRINCIPAL_MODULE, () => ({
    ...realPrincipal,
    resolveMembership: () => Promise.resolve(read()),
  }));
  afterAll(() => {
    mock.module(PRINCIPAL_MODULE, () => realPrincipal);
  });
}

export async function restoreModulesAfterThisFile(specifiers: readonly string[]): Promise<void> {
  const originals = new Map<string, Record<string, unknown>>();
  for (const specifier of specifiers) {
    originals.set(specifier, { ...(await import(specifier)) });
  }
  afterAll(() => {
    for (const [specifier, real] of originals) mock.module(specifier, () => real);
  });
}

const SESSION_COOKIE_NAME = 'session_token';

let requestHeaders = new Headers();

mock.module('next/headers', () => ({
  ...nextHeaders,
  headers: () => Promise.resolve(new Headers(requestHeaders)),
}));

function sessionCookies(responseHeaders: Headers): string {
  return responseHeaders
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((pair) => pair.includes(SESSION_COOKIE_NAME) && !pair.includes('session_data'))
    .join('; ');
}

export async function signedInAs(userId: string, organizationId?: string): Promise<void> {
  const [user] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (user === undefined) throw new Error(`signedInAs: no user ${userId}`);
  const otp = await auth.api.createVerificationOTP({
    body: { email: user.email, type: 'sign-in' },
  });
  const signedIn = await auth.api.signInEmailOTP({
    body: { email: user.email, otp },
    headers: new Headers({ [DEV_LOGIN_HEADER]: '1' }),
    returnHeaders: true,
  });
  requestHeaders = new Headers({ cookie: sessionCookies(signedIn.headers) });
  if (organizationId === undefined) return;
  await auth.api.setActiveOrganization({
    headers: new Headers(requestHeaders),
    body: { organizationId },
  });
}

export function signedOut(): void {
  requestHeaders = new Headers();
}
