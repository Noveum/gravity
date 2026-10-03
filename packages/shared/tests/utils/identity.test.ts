import { describe, expect, test } from 'bun:test';
import {
  companyDomainFromEmail,
  normalizeDomain,
  normalizeLinkedinProfileUrl,
  parseIdentityInput,
} from '../../src/utils/identity.ts';

describe('normalizeDomain', () => {
  test('strips scheme, www, port, path and case', () => {
    expect(normalizeDomain('https://WWW.Acme.com:8443/about?x=1')).toBe('acme.com');
    expect(normalizeDomain(' acme.co.uk. ')).toBe('acme.co.uk');
  });

  test('refuses things that are not domains', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
  });
});

describe('companyDomainFromEmail', () => {
  test('returns the business domain and ignores free mail', () => {
    expect(companyDomainFromEmail('Ada@Acme.io')).toBe('acme.io');
    expect(companyDomainFromEmail('ada@gmail.com')).toBeNull();
    expect(companyDomainFromEmail('nobody')).toBeNull();
  });
});

describe('normalizeLinkedinProfileUrl', () => {
  test('canonicalises every common profile form', () => {
    const canonical = 'https://www.linkedin.com/in/ada-lovelace';
    expect(normalizeLinkedinProfileUrl('https://www.linkedin.com/in/Ada-Lovelace/')).toBe(
      canonical,
    );
    expect(normalizeLinkedinProfileUrl('linkedin.com/in/ada-lovelace?trk=x')).toBe(canonical);
    expect(normalizeLinkedinProfileUrl('https://uk.linkedin.com/in/ada-lovelace')).toBe(canonical);
  });

  test('refuses company pages and other hosts', () => {
    expect(normalizeLinkedinProfileUrl('https://www.linkedin.com/company/acme')).toBeNull();
    expect(normalizeLinkedinProfileUrl('https://example.com/in/ada')).toBeNull();
  });
});

describe('parseIdentityInput', () => {
  test('recognises a LinkedIn URL, an email and a name', () => {
    expect(parseIdentityInput(' https://linkedin.com/in/ada ')).toEqual({
      kind: 'linkedin',
      linkedinUrl: 'https://www.linkedin.com/in/ada',
    });
    expect(parseIdentityInput('Ada@Acme.io')).toEqual({ kind: 'email', email: 'ada@acme.io' });
    expect(parseIdentityInput('Ada Lovelace')).toEqual({ kind: 'name', name: 'Ada Lovelace' });
    expect(parseIdentityInput('   ')).toBeNull();
  });
});
