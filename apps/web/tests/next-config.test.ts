import { describe, expect, test } from 'bun:test';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import config from '../next.config.ts';

async function headersFor(phase: string, pathname: string): Promise<Map<string, string>> {
  const rules = (await config(phase).headers?.()) ?? [];
  const sent = new Map<string, string>();
  for (const rule of rules) {
    if (getPathMatch(rule.source)(pathname) === false) continue;
    for (const header of rule.headers) sent.set(header.key.toLowerCase(), header.value);
  }
  return sent;
}

describe('next.config headers', () => {
  test.each([
    [PHASE_PRODUCTION_BUILD, '/oauth/authorize'],
    [PHASE_PRODUCTION_BUILD, '/leads'],
    [PHASE_PRODUCTION_BUILD, '/'],
    [PHASE_DEVELOPMENT_SERVER, '/oauth/authorize'],
    [PHASE_DEVELOPMENT_SERVER, '/people/0190d7e4-1a2b-7c3d-8e4f-5a6b7c8d9e0f'],
  ])('%s forbids framing %s', async (phase, pathname) => {
    const sent = await headersFor(phase, pathname);
    expect(sent.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(sent.get('x-frame-options')).toBe('DENY');
  });
});
