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
