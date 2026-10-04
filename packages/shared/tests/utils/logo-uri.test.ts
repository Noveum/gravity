import { describe, expect, test } from 'bun:test';
import { isAllowedLogoUri } from '../../src/utils/logo-uri.ts';

describe('isAllowedLogoUri', () => {
  test.each([
    ['https://agent.example.com/logo.png', true],
    ['https://agent.example.com/logo.svg?v=2', true],
    ['http://agent.example.com/logo.png', false],
    ['javascript:alert(1)', false],
    ['data:image/svg+xml,<svg/>', false],
    ['https://agent.example.com/a.png,javascript:alert(1)', false],
    ['//agent.example.com/logo.png', false],
    ['not a url', false],
    ['', false],
  ])('%s is %p', (uri, allowed) => {
    expect(isAllowedLogoUri(uri)).toBe(allowed);
  });
});
