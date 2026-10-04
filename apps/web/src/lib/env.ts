import { parseDomainList } from '@gravity/shared/utils';
import { z } from 'zod';

type Environment = Readonly<Record<string, string | undefined>>;

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optional = z.preprocess(blankToUndefined, z.string().optional());

const rawSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default('http://localhost:3300'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3300'),
  EMAIL_FROM: z.string().min(1).default('Gravity <auth@gravity.local>'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GRAVITY_OIDC_ISSUER: z.preprocess(blankToUndefined, z.url().optional()),
  GRAVITY_OIDC_CLIENT_ID: optional,
  GRAVITY_OIDC_CLIENT_SECRET: optional,
  GRAVITY_OIDC_LABEL: optional,
  GRAVITY_PASSWORD_AUTH: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  CRON_SECRET: optional,
});

export interface OidcSlot {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly label: string;
}

export type ServerEnv = z.infer<typeof rawSchema> & { readonly oidc: OidcSlot | null };

const OIDC_KEYS = [
  'GRAVITY_OIDC_ISSUER',
  'GRAVITY_OIDC_CLIENT_ID',
  'GRAVITY_OIDC_CLIENT_SECRET',
  'GRAVITY_OIDC_LABEL',
] as const;

function oidcSlot(raw: z.infer<typeof rawSchema>): OidcSlot | null {
  const present = OIDC_KEYS.filter((key) => raw[key] !== undefined);
  if (present.length === 0) return null;
  const missing = OIDC_KEYS.filter((key) => raw[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `The sign-in provider slot is half configured. Set ${missing.join(', ')} or clear ${present.join(', ')}.`,
    );
  }
  return {
    issuer: raw.GRAVITY_OIDC_ISSUER ?? '',
    clientId: raw.GRAVITY_OIDC_CLIENT_ID ?? '',
    clientSecret: raw.GRAVITY_OIDC_CLIENT_SECRET ?? '',
    label: raw.GRAVITY_OIDC_LABEL ?? '',
  };
}

export function parseServerEnv(environment: Environment): ServerEnv {
  const raw = rawSchema.parse(environment);
  return { ...raw, oidc: oidcSlot(raw) };
}

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached === null) cached = parseServerEnv(process.env);
  return cached;
}

export function signUpIsOpen(): boolean {
  return (
    parseDomainList(process.env['ALLOWED_EMAIL_DOMAINS'], 'ALLOWED_EMAIL_DOMAINS').length === 0
  );
}

const DEVELOPMENT_ORIGIN = 'http://localhost:3300';
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());

export function publicAppUrl(environment: Environment = process.env): string {
  const authUrl = optionalUrl.parse(environment['BETTER_AUTH_URL']);
  if (environment['NODE_ENV'] !== 'production') {
    return new URL(authUrl ?? DEVELOPMENT_ORIGIN).origin;
  }
  const appUrl = optionalUrl.parse(environment['NEXT_PUBLIC_APP_URL']);
  if (authUrl === undefined || appUrl === undefined) {
    const missing = [
      authUrl === undefined ? 'BETTER_AUTH_URL' : null,
      appUrl === undefined ? 'NEXT_PUBLIC_APP_URL' : null,
    ].filter((name) => name !== null);
    throw new Error(
      `Set ${missing.join(' and ')} to the public origin of this deployment. Gravity never falls back to localhost in production.`,
    );
  }
  const origin = new URL(authUrl).origin;
  const appOrigin = new URL(appUrl).origin;
  if (origin !== appOrigin) {
    throw new Error(
      `BETTER_AUTH_URL (${origin}) and NEXT_PUBLIC_APP_URL (${appOrigin}) must name the same origin, because sign in, OAuth and the MCP server are all advertised on one origin.`,
    );
  }
  return origin;
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${publicAppUrl()}/`).toString();
}

export function mcpServerUrl(): string {
  return absoluteUrl('/mcp');
}
