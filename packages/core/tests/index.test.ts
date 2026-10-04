import { describe, expect, test } from 'bun:test';
import * as core from '../src/index.ts';

describe('the public index of @gravity/core', () => {
  test('leaves the demo seed out, so it never reaches the web bundle', () => {
    const names = Object.keys(core);
    for (const name of [
      'seedDemoWorkspace',
      'publishSeededOutbox',
      'DEMO_BRANDS',
      'DEMO_SEED_MARKER',
    ]) {
      expect(names).not.toContain(name);
    }
    expect(names).toContain('commitImport');
  });
});
