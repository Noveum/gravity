import { createHmac } from 'node:crypto';
import { passkey } from '@better-auth/passkey';
import {
  assertEmailDomainAllowed,
  publishSessionRevoked,
  redisRateLimitStorage,
} from '@gravity/core';
import { db, eq, inArray, schema } from '@gravity/db';
import {
  assertEmailConfigured,
  resetPasswordEmail,
  sendEmail,
  signInCodeEmail,
} from '@gravity/services/email';
import { MCP_OAUTH_SCOPES } from '@gravity/shared/constants';
import { DomainError } from '@gravity/shared/errors';
import { signInCodeRequestSchema } from '@gravity/shared/validators';
import { type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, mcp } from 'better-auth/plugins';
import { z } from 'zod';
import { isDevLoginRequest } from '@/lib/api/dev-login.ts';
import { deploymentAuthOptions } from '@/lib/auth/deployment.ts';
import { OIDC_PROVIDER_ID, oidcPlugins } from '@/lib/auth/oidc.ts';
import { organizationSessionPlugin } from '@/lib/auth/organization.ts';
import { mcpServerUrl, serverEnv } from '@/lib/env.ts';
import { uniqueHandleFor } from './handle.ts';
import { hashPassword, verifyPassword } from './password.ts';

export const MCP_CONSENT_PATH = '/oauth/authorize';
export const MCP_LOGIN_PATH = '/login';
export const MCP_AUTHORIZE_START_PATH = '/api/oauth/start';
export const MCP_TOKEN_RATE_LIMIT_PROBE_HEADER = 'x-gravity-mcp-token-rate-limit-probe';

function mcpTokenRateLimitProbe() {
  return {
    id: 'gravity-mcp-token-rate-limit-probe' as const,
    onRequest(request: Request) {
      if (new URL(request.url).pathname !== '/api/auth/mcp/token') {
        return Promise.resolve(undefined);
      }
      if (request.headers.get(MCP_TOKEN_RATE_LIMIT_PROBE_HEADER) !== '1') {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ response: new Response(null, { status: 204 }) });
    },
  } satisfies BetterAuthPlugin;
}

const passkeyAssertionSchema = z.object({ response: z.object({ id: z.string().min(1) }) });

function verificationSucceeded(ctx: { context?: { returned?: unknown } }): boolean {
  const returned = ctx.context?.returned;
  if (returned === null || returned === undefined) return false;
  if (returned instanceof Error) return false;
  if (typeof returned === 'object' && 'error' in returned) {
    return (returned as { error: unknown }).error == null;
  }
  return true;
}

async function touchPasskeyLastUsed(body: unknown): Promise<void> {
  const parsed = passkeyAssertionSchema.safeParse(body);
  if (!parsed.success) return;
  await db
    .update(schema.passkey)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.passkey.credentialID, parsed.data.response.id));
}

const SESSION_CACHE_SECONDS = 5 * 60;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_REVOKING_PATHS = new Set([
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
]);

function socialProviders() {
  const env = serverEnv();
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {};
  return { ...google, ...github };
}

export const enabledSocialProviders: readonly string[] = Object.keys(socialProviders());

export const passwordAuthEnabled: boolean = serverEnv().GRAVITY_PASSWORD_AUTH;

const SIGN_IN_ATTEMPTS_PER_MINUTE = 5;
const SIGN_UP_ATTEMPTS_PER_HOUR = 5;
const SIGN_IN_CODES_PER_TEN_MINUTES = 10;
const SIGN_IN_CODE_PATH = '/email-otp/send-verification-otp';
const SIGN_IN_CODE_EXPIRES_IN_SECONDS = 300;

function authRateLimit() {
  const customStorage =
    process.env['NODE_ENV'] === 'production' ? redisRateLimitStorage() : undefined;
  return {
    customRules: AUTH_RATE_LIMIT_RULES,
    ...(customStorage === undefined ? {} : { customStorage }),
  };
}

export const AUTH_RATE_LIMIT_RULES = {
  '/sign-in/email': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
  '/sign-up/email': { window: 3600, max: SIGN_UP_ATTEMPTS_PER_HOUR },
  [SIGN_IN_CODE_PATH]: { window: 600, max: SIGN_IN_CODES_PER_TEN_MINUTES },
  '/mcp/token': { window: 60, max: 30 },
  '/mcp/register': { window: 3600, max: 10 },
};

async function takenHandles(candidates: readonly string[]): Promise<Set<string>> {
  const rows = await db
    .select({ handle: schema.user.handle })
    .from(schema.user)
    .where(inArray(schema.user.handle, [...candidates]));
  return new Set(rows.map((row) => row.handle));
}

function handleFor(email: string, name: string): Promise<string> {
  return uniqueHandleFor(email, name, takenHandles);
}

function emailAndPassword() {
  if (!passwordAuthEnabled) return { enabled: false } as const;
  return {
    enabled: true,
    minPasswordLength: 12,
    sendResetPassword: async (
      { user, url, token }: { user: { email: string }; url: string; token: string },
      request?: Request,
    ) => {
      if (isDevLoginRequest(request)) return;
      assertEmailConfigured();
      const content = await resetPasswordEmail({ url, email: user.email });
      await sendEmail(db, {
        to: user.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        template: 'reset-password',
        idempotencyKey: `reset-password:${token}`,
      });
    },
    password: {
      hash: (password: string) => hashPassword(password),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        verifyPassword(hash, password),
    },
  } as const;
}

function assertSignUpAllowed(email: string): void {
  try {
    assertEmailDomainAllowed(email);
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === 'forbidden') {
      throw new APIError('FORBIDDEN', {
        code: 'EMAIL_DOMAIN_NOT_ALLOWED',
        message: error.message,
      });
    }
    throw error;
  }
}

function assertSignInCodesDeliverable(context: { headers?: Headers | undefined }): void {
  if (isDevLoginRequest(context)) return;
  try {
    assertEmailConfigured();
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      throw new APIError('SERVICE_UNAVAILABLE', {
        code: 'EMAIL_UNAVAILABLE',
        message: error.message,
      });
    }
    throw error;
  }
}

function signInCodeIdempotencyKey(email: string, otp: string): string {
  const digest = createHmac('sha256', serverEnv().BETTER_AUTH_SECRET)
    .update(`${email}:${otp}`)
    .digest('hex');
  return `sign-in-code:${digest}`;
}

const deployment = deploymentAuthOptions();

export const auth = betterAuth({
  appName: 'Gravity',
  baseURL: deployment.baseURL,
  secret: serverEnv().BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: emailAndPassword(),
  rateLimit: authRateLimit(),
  socialProviders: socialProviders(),
  account: {
    accountLinking: { enabled: true, allowUnlinkingAll: false, allowDifferentEmails: false },
  },
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    cookieCache: { enabled: true, maxAge: SESSION_CACHE_SECONDS },
  },
  user: {
    additionalFields: {
      handle: { type: 'string', required: false, input: false },
      timezone: { type: 'string', required: false, input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware((ctx) => {
      if (ctx.path === SIGN_IN_CODE_PATH) {
        const parsed = signInCodeRequestSchema.safeParse(ctx.body);
        if (parsed.success) assertSignUpAllowed(parsed.data.email);
        assertSignInCodesDeliverable(ctx);
      }
      return Promise.resolve();
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/passkey/verify-authentication' && verificationSucceeded(ctx)) {
        await touchPasskeyLastUsed(ctx.body);
      }
      if (ctx.path !== undefined && SESSION_REVOKING_PATHS.has(ctx.path)) {
        const authed = await getSessionFromCtx(ctx);
        if (authed !== null) await publishSessionRevoked(authed.user.id);
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          assertSignUpAllowed(user.email);
          return { data: { ...user, handle: await handleFor(user.email, user.name) } };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const rows = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);
          const email = rows[0]?.email;
          if (email !== undefined) assertSignUpAllowed(email);
          return { data: session };
        },
      },
    },
  },
  plugins: [
    ...deployment.plugins,
    ...oidcPlugins(serverEnv().oidc),
    mcpTokenRateLimitProbe(),
    passkey({ rpName: 'Gravity' }),
    emailOTP({
      expiresIn: SIGN_IN_CODE_EXPIRES_IN_SECONDS,
      storeOTP: 'hashed',
      sendVerificationOTP: async ({ email, otp, type }, context) => {
        if (isDevLoginRequest(context)) return;
        if (type !== 'sign-in') return;
        assertEmailConfigured();
        assertSignUpAllowed(email);
        const content = await signInCodeEmail({ code: otp, email });
        await sendEmail(db, {
          to: email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          template: 'sign-in-code',
          idempotencyKey: signInCodeIdempotencyKey(email, otp),
        });
      },
    }),
    organizationSessionPlugin(),
    mcp({
      loginPage: MCP_LOGIN_PATH,
      resource: mcpServerUrl(),
      oidcConfig: {
        loginPage: MCP_LOGIN_PATH,
        consentPage: MCP_CONSENT_PATH,
        allowDynamicClientRegistration: true,
        requirePKCE: true,
        scopes: [...MCP_OAUTH_SCOPES],
      },
    }),
    nextCookies(),
  ],
});

const oidcSlot = serverEnv().oidc;

export const oidcProvider: { readonly id: typeof OIDC_PROVIDER_ID; readonly label: string } | null =
  oidcSlot === null ? null : { id: OIDC_PROVIDER_ID, label: oidcSlot.label };

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
