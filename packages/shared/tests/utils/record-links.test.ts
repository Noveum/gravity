import { describe, expect, test } from 'bun:test';
import { linkedWorkspace, recordLinks } from '../../src/utils/record-links.ts';

describe('recordLinks', () => {
  test('build deep links that name the workspace, with or without a trailing slash', () => {
    const links = recordLinks('https://crm.example.com/', 'acme');
    expect(links.workspace).toBe('acme');
    expect(links.app).toBe('https://crm.example.com/leads?w=acme');
    expect(links.pipeline('ABC')).toBe('https://crm.example.com/leads/ABC?w=acme');
    expect(links.lead('ABC-12')).toBe('https://crm.example.com/l/ABC-12?w=acme');
    expect(links.person('p 1')).toBe('https://crm.example.com/people/p%201?w=acme');
    expect(links.company('c1')).toBe('https://crm.example.com/companies/c1?w=acme');
    expect(recordLinks('https://crm.example.com', 'a b').app).toBe(
      'https://crm.example.com/leads?w=a%20b',
    );
  });

  test('linkedWorkspace reads the workspace a link names', () => {
    expect(linkedWorkspace('https://crm.example.com/l/ABC-1?w=acme#top')).toBe('acme');
    expect(linkedWorkspace('crm.example.com/people/p1?tab=x&w=Other')).toBe('other');
    expect(linkedWorkspace('https://crm.example.com/l/ABC-1')).toBeNull();
    expect(linkedWorkspace('https://crm.example.com/l/ABC-1?w=')).toBeNull();
  });
});
