import { emailDomain } from './email-domain.ts';

const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'yandex.com',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  'mail.com',
]);

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKEDIN_PROFILE_PATH = /^\/in\/([^/?#]+)/;

export function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const withoutScheme = trimmed.replace(SCHEME, '');
  const host = (withoutScheme.split(/[/?#]/)[0] ?? '').replace(/:\d+$/, '').replace(/\.$/, '');
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  return DOMAIN.test(bare) ? bare : null;
}

export function companyDomainFromEmail(email: string): string | null {
  const domain = emailDomain(email.trim());
  if (domain === null) return null;
  const normalized = normalizeDomain(domain);
  if (normalized === null || FREE_MAIL_DOMAINS.has(normalized)) return null;
  return normalized;
}

export function normalizeLinkedinProfileUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const slug = LINKEDIN_PROFILE_PATH.exec(url.pathname)?.[1];
  if (slug === undefined) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const clean = decoded.trim().toLowerCase();
  return clean.length === 0 ? null : `https://www.linkedin.com/in/${encodeURIComponent(clean)}`;
}

export type IdentityInput =
  | { readonly kind: 'linkedin'; readonly linkedinUrl: string }
  | { readonly kind: 'email'; readonly email: string }
  | { readonly kind: 'name'; readonly name: string };

export function parseIdentityInput(raw: string): IdentityInput | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const linkedinUrl = normalizeLinkedinProfileUrl(trimmed);
  if (linkedinUrl !== null) return { kind: 'linkedin', linkedinUrl };
  if (EMAIL.test(trimmed)) return { kind: 'email', email: trimmed.toLowerCase() };
  return { kind: 'name', name: trimmed };
}
