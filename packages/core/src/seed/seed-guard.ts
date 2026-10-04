import { validationFailed } from '@gravity/shared/errors';
import { normalizeDomain } from '@gravity/shared/utils';

export const LOCAL_DATABASE_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '[::1]',
  'postgres',
  'gravity-postgres',
];

export const RESERVED_SEED_TLDS: readonly string[] = ['test', 'example', 'invalid', 'localhost'];

export interface SeedTarget {
  readonly nodeEnv: string | undefined;
  readonly databaseUrl: string | undefined;
}

export interface SeedArgs {
  readonly slug: string;
  readonly domain: string;
  readonly reuse: boolean;
  readonly allowRemote: boolean;
  readonly allowRealDomain: boolean;
}

const SEED_ARG_DEFAULTS = { slug: 'demo', domain: 'gravity.test' } as const;

function hasAmbiguousAuthority(databaseUrl: string): boolean {
  const afterScheme = databaseUrl.split('//')[1] ?? '';
  const authority = afterScheme.split(/[/?#]/)[0] ?? '';
  return authority.includes(',') || authority.split('@').length > 2;
}

function isLocalDatabase(databaseUrl: string): boolean {
  if (hasAmbiguousAuthority(databaseUrl.trim())) return false;
  let url: URL;
  try {
    url = new URL(databaseUrl.trim());
  } catch {
    return false;
  }
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) return false;
  return LOCAL_DATABASE_HOSTS.includes(url.hostname.toLowerCase());
}

export function assertLocalSeedTarget(target: SeedTarget, allowRemote: boolean): void {
  if (allowRemote) return;
  if (target.nodeEnv?.trim().toLowerCase() === 'production') {
    throw new Error(
      'The demo seed is a local development tool and NODE_ENV is production. Pass --allow-remote to run it anyway.',
    );
  }
  if (target.databaseUrl === undefined || target.databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run bun run infra:up.');
  }
  if (!isLocalDatabase(target.databaseUrl)) {
    throw new Error(
      `The demo seed only runs against a local database (${LOCAL_DATABASE_HOSTS.join(', ')}), and DATABASE_URL points elsewhere. Pass --allow-remote to run it anyway.`,
    );
  }
}

export function assertSeedDomain(domain: string, allowRealDomain: boolean): string {
  const normalized = normalizeDomain(domain);
  if (normalized === null) {
    throw validationFailed(`${JSON.stringify(domain)} is not a domain. Use one like gravity.test.`);
  }
  const tld = normalized.slice(normalized.lastIndexOf('.') + 1);
  if (!(allowRealDomain || RESERVED_SEED_TLDS.includes(tld))) {
    throw validationFailed(
      `${normalized} is not a reserved test domain (.${RESERVED_SEED_TLDS.join(', .')}), and the seed signs in users on it. Pass --allow-real-domain to use it anyway.`,
    );
  }
  return normalized;
}

const VALUE_FLAGS = { '--slug': 'slug', '--domain': 'domain' } as const;
const SWITCH_FLAGS = {
  '--reuse': 'reuse',
  '--allow-remote': 'allowRemote',
  '--allow-real-domain': 'allowRealDomain',
} as const;

function isValueFlag(arg: string): arg is keyof typeof VALUE_FLAGS {
  return arg in VALUE_FLAGS;
}

function isSwitchFlag(arg: string): arg is keyof typeof SWITCH_FLAGS {
  return arg in SWITCH_FLAGS;
}

export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const parsed = {
    ...SEED_ARG_DEFAULTS,
    reuse: false,
    allowRemote: false,
    allowRealDomain: false,
  } as { -readonly [K in keyof SeedArgs]: SeedArgs[K] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (isValueFlag(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      parsed[VALUE_FLAGS[arg]] = value;
      index += 1;
    } else if (isSwitchFlag(arg)) {
      parsed[SWITCH_FLAGS[arg]] = true;
    } else {
      throw new Error(
        arg.startsWith('--') ? `Unknown option ${arg}.` : `Unexpected argument ${arg}.`,
      );
    }
  }
  return parsed;
}
