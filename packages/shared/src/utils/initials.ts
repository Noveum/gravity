export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}
