const DENIED_REDIRECT_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
  'ftp:',
  'ws:',
  'wss:',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const APP_SCHEME = /^[a-z][a-z0-9+.-]*:$/;

export function isAllowedRedirectUri(uri: string): boolean {
  const trimmed = uri.trim();
  if (trimmed.includes(',')) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  const scheme = url.protocol.toLowerCase();
  if (url.hash !== '') return false;
  if (DENIED_REDIRECT_SCHEMES.has(scheme)) return false;
  if (scheme === 'https:') return true;
  if (scheme === 'http:') return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  return APP_SCHEME.test(scheme);
}
