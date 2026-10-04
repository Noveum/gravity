export const DEFAULT_CONTINUE_URL = '/today';

const RESOLUTION_ORIGIN = 'https://gravity.invalid';
const UNSAFE_CHARACTER = /[\\\s\p{Cc}]/u;

function isSameOriginPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (UNSAFE_CHARACTER.test(value)) return false;
  try {
    return new URL(value, RESOLUTION_ORIGIN).origin === RESOLUTION_ORIGIN;
  } catch {
    return false;
  }
}

export function safeCallback(value: string | string[] | undefined): string {
  if (typeof value !== 'string') return DEFAULT_CONTINUE_URL;
  return isSameOriginPath(value) ? value : DEFAULT_CONTINUE_URL;
}

const MCP_AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
  'nonce',
] as const;

export function mcpContinueUrl(
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  if (typeof params['client_id'] !== 'string' || typeof params['response_type'] !== 'string') {
    return undefined;
  }
  const search = new URLSearchParams();
  for (const key of MCP_AUTHORIZE_PARAMS) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) search.set(key, value);
  }
  return `/api/oauth/start?${search.toString()}`;
}
