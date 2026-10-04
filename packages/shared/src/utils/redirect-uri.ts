const DENIED_REDIRECT_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'filesystem:',
  'blob:',
  'about:',
  'view-source:',
  'ftp:',
  'ftps:',
  'sftp:',
  'smb:',
  'nfs:',
  'afp:',
  'webdav:',
  'jar:',
  'mhtml:',
  'mk:',
  'its:',
  'res:',
  'hcp:',
  'help:',
  'shell:',
  'search:',
  'search-ms:',
  'microsoft-edge:',
  'intent:',
  'content:',
  'ws:',
  'wss:',
]);
const OS_HANDLER_PREFIX = 'ms-';
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
  if (DENIED_REDIRECT_SCHEMES.has(scheme) || scheme.startsWith(OS_HANDLER_PREFIX)) return false;
  if (scheme === 'https:') return true;
  if (scheme === 'http:') return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  return APP_SCHEME.test(scheme);
}
