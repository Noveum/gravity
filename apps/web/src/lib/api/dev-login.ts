export const DEV_LOGIN_HEADER = 'x-gravity-dev-login';

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env['GRAVITY_DEV_LOGIN'] === 'true';
}

export function isDevLoginRequest(context?: {
  readonly headers?: HeadersInit | undefined;
  readonly request?: Request | undefined;
}): boolean {
  if (!devLoginEnabled()) return false;
  const source = context?.headers ?? context?.request?.headers;
  if (source === undefined) return false;
  return new Headers(source).get(DEV_LOGIN_HEADER) === '1';
}
