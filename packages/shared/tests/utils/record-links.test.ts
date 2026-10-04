import { describe, expect, test } from 'bun:test';
import { recordLinks } from '../../src/utils/record-links.ts';

describe('recordLinks', () => {
  test('build deep links from a base URL with or without a trailing slash', () => {
    const links = recordLinks('https://crm.example.com/');
    expect(links.app).toBe('https://crm.example.com/leads');
    expect(links.pipeline('ABC')).toBe('https://crm.example.com/leads/ABC');
    expect(links.lead('ABC-12')).toBe('https://crm.example.com/l/ABC-12');
    expect(links.person('p 1')).toBe('https://crm.example.com/people/p%201');
    expect(links.company('c1')).toBe('https://crm.example.com/companies/c1');
    expect(recordLinks('https://crm.example.com').app).toBe('https://crm.example.com/leads');
  });
});
