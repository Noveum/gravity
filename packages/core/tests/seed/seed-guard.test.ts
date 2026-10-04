import { describe, expect, test } from 'bun:test';
import {
  assertLocalSeedTarget,
  assertSeedDomain,
  parseSeedArgs,
} from '../../src/seed/seed-guard.ts';

const LOCAL = 'postgres://gravity:gravity@localhost:5436/gravity';

function target(databaseUrl: string | undefined, nodeEnv: string | undefined = 'development') {
  return { databaseUrl, nodeEnv };
}

describe('assertLocalSeedTarget', () => {
  test('admits the local hosts and the compose postgres host', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'postgres', 'gravity-postgres']) {
      expect(() =>
        assertLocalSeedTarget(target(`postgres://u:p@${host}:5436/gravity`), false),
      ).not.toThrow();
    }
    expect(() => assertLocalSeedTarget(target(LOCAL, undefined), false)).not.toThrow();
  });

  test('refuses a remote host unless remote is allowed', () => {
    const remote = 'postgres://u:p@db.example-hosting.com:5432/gravity';
    expect(() => assertLocalSeedTarget(target(remote), false)).toThrow(/--allow-remote/);
    expect(() => assertLocalSeedTarget(target(remote), true)).not.toThrow();
  });

  test('refuses production even on a local host unless remote is allowed', () => {
    expect(() => assertLocalSeedTarget(target(LOCAL, 'production'), false)).toThrow(/production/);
    expect(() => assertLocalSeedTarget(target(LOCAL, 'production'), true)).not.toThrow();
  });

  test('refuses an authority that postgres.js could read as another host', () => {
    for (const url of [
      'postgres://u:p@db.remote.io@localhost:5436/gravity',
      'postgres://u@x:p@localhost:5436/gravity',
      'postgres://u:p@localhost,db.remote.io/gravity',
      'postgres://u:p,x@localhost:5436/gravity',
    ]) {
      expect(() => assertLocalSeedTarget(target(url), false)).toThrow(/--allow-remote/);
    }
  });

  test('reads NODE_ENV without regard to case or surrounding space', () => {
    for (const nodeEnv of ['Production', ' production ', 'PRODUCTION\n']) {
      expect(() => assertLocalSeedTarget(target(LOCAL, nodeEnv), false)).toThrow(/production/);
    }
  });

  test('refuses an unset, unparsable, multi host or host overriding url', () => {
    expect(() => assertLocalSeedTarget(target(undefined), false)).toThrow(/DATABASE_URL/);
    expect(() => assertLocalSeedTarget(target('not a url'), false)).toThrow(/--allow-remote/);
    expect(() =>
      assertLocalSeedTarget(target('postgres://u:p@localhost:5436,db.remote.io:5432/g'), false),
    ).toThrow(/--allow-remote/);
    expect(() => assertLocalSeedTarget(target(`${LOCAL}?host=db.remote.io`), false)).toThrow(
      /--allow-remote/,
    );
    expect(() =>
      assertLocalSeedTarget(target('postgres://u:p@localhost.evil.com:5432/g'), false),
    ).toThrow(/--allow-remote/);
  });
});

describe('assertSeedDomain', () => {
  test('lowercases and admits the reserved test domains', () => {
    expect(assertSeedDomain('Gravity.TEST', false)).toBe('gravity.test');
    for (const domain of ['a.example', 'a.invalid', 'a.localhost', 'mail.a.test']) {
      expect(assertSeedDomain(domain, false)).toBe(domain);
    }
  });

  test('refuses a real domain unless allowed, and a malformed one always', () => {
    expect(() => assertSeedDomain('acme.com', false)).toThrow(/--allow-real-domain/);
    expect(assertSeedDomain('acme.com', true)).toBe('acme.com');
    expect(() => assertSeedDomain('not a domain', true)).toThrow(/domain/);
    expect(() => assertSeedDomain('', true)).toThrow(/domain/);
  });
});

describe('parseSeedArgs', () => {
  test('defaults and every flag', () => {
    expect(parseSeedArgs([])).toEqual({
      slug: 'demo',
      domain: 'gravity.test',
      reuse: false,
      allowRemote: false,
      allowRealDomain: false,
    });
    expect(
      parseSeedArgs([
        '--slug',
        'tour',
        '--domain',
        'tour.test',
        '--reuse',
        '--allow-remote',
        '--allow-real-domain',
      ]),
    ).toEqual({
      slug: 'tour',
      domain: 'tour.test',
      reuse: true,
      allowRemote: true,
      allowRealDomain: true,
    });
  });

  test('a value flag never takes another flag as its value', () => {
    expect(() => parseSeedArgs(['--slug', '--reuse'])).toThrow(/--slug needs a value/);
    expect(() => parseSeedArgs(['--domain'])).toThrow(/--domain needs a value/);
  });

  test('an unknown flag or stray argument is refused', () => {
    expect(() => parseSeedArgs(['--slugg', 'x'])).toThrow(/Unknown option --slugg/);
    expect(() => parseSeedArgs(['demo'])).toThrow(/Unexpected argument demo/);
  });
});
