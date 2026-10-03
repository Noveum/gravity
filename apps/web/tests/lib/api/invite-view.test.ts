import { afterEach, describe, expect, test } from 'bun:test';
import { revealToken } from '@/lib/api/invite-view.ts';

const savedDevLogin = process.env['GRAVITY_DEV_LOGIN'];
const savedNodeEnv = process.env['NODE_ENV'];

afterEach(() => {
  if (savedDevLogin === undefined) delete process.env['GRAVITY_DEV_LOGIN'];
  else process.env['GRAVITY_DEV_LOGIN'] = savedDevLogin;
  Reflect.set(process.env, 'NODE_ENV', savedNodeEnv);
});

describe('revealToken', () => {
  test('returns the token only while dev login is on', () => {
    process.env['GRAVITY_DEV_LOGIN'] = 'true';
    expect(revealToken('abc')).toEqual({ token: 'abc' });
    process.env['GRAVITY_DEV_LOGIN'] = 'false';
    expect(revealToken('abc')).toEqual({});
    delete process.env['GRAVITY_DEV_LOGIN'];
    expect(revealToken('abc')).toEqual({});
  });

  test('never returns the token in production, even with the flag left on', () => {
    process.env['GRAVITY_DEV_LOGIN'] = 'true';
    Reflect.set(process.env, 'NODE_ENV', 'production');
    expect(revealToken('abc')).toEqual({});
  });
});
