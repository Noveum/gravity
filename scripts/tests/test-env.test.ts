import { afterEach, describe, expect, test } from 'bun:test';
import { laneDatabase, laneSuffix, resolveTestDatabaseUrl } from '../test-env.ts';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe('resolveTestDatabaseUrl', () => {
  test('refuses a fallback that is not a gravity test database', () => {
    expect(() => resolveTestDatabaseUrl('gravity')).toThrow(/Refusing to run tests/);
  });

  test('defaults to the local gravity postgres', () => {
    delete process.env['DATABASE_URL'];
    delete process.env['TEST_DATABASE_URL'];
    delete process.env['GRAVITY_TEST_LANE'];
    expect(resolveTestDatabaseUrl('gravity_test_core')).toBe(
      'postgres://gravity:gravity@localhost:5436/gravity_test_core',
    );
  });

  test('swaps the database name of an ambient url', () => {
    process.env['DATABASE_URL'] = 'postgres://gravity:gravity@localhost:5436/gravity';
    delete process.env['GRAVITY_TEST_LANE'];
    expect(resolveTestDatabaseUrl('gravity_test_web')).toBe(
      'postgres://gravity:gravity@localhost:5436/gravity_test_web',
    );
  });

  test('refuses an explicit url pointing at a non test database', () => {
    process.env['TEST_DATABASE_URL'] = 'postgres://gravity:gravity@localhost:5436/gravity';
    expect(() => resolveTestDatabaseUrl('gravity_test_core')).toThrow(/TEST_DATABASE_URL/);
  });
});

describe('lanes', () => {
  test('two raw lanes that normalise alike stay apart', () => {
    expect(laneSuffix('agent-1')).not.toBe(laneSuffix('agent_1'));
  });

  test('an empty lane keeps the base name', () => {
    expect(laneDatabase('gravity_test_core', '')).toBe('gravity_test_core');
  });
});
