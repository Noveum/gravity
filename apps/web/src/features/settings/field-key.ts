const MAX_KEY = 40;
const MAX_OPTION_VALUE = 64;

function slug(label: string, separator: '_' | '-'): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(' ', separator);
}

export function fieldKeyFromLabel(label: string): string {
  const key = slug(label, '_');
  if (key.length === 0) return 'field';
  const prefixed = /^[a-z]/.test(key) ? key : `field_${key}`;
  return prefixed.slice(0, MAX_KEY).replace(/_+$/, '');
}

export function optionsFromLines(text: string): { value: string; label: string }[] {
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const line of text.split('\n')) {
    const label = line.trim();
    const value = slug(label, '-').slice(0, MAX_OPTION_VALUE);
    if (label.length === 0 || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label });
  }
  return options;
}

export function movedIds(ids: readonly string[], index: number, direction: -1 | 1): string[] {
  const next = [...ids];
  const target = index + direction;
  const here = next[index];
  const there = next[target];
  if (here === undefined || there === undefined) return next;
  next[index] = there;
  next[target] = here;
  return next;
}
