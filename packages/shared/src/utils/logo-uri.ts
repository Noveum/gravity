export function isAllowedLogoUri(uri: string): boolean {
  if (uri.includes(',') || !URL.canParse(uri)) return false;
  return new URL(uri).protocol === 'https:';
}
