const LEAD_KEY = /^([A-Za-z]{2,5})-([1-9]\d{0,8})$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function formatLeadKey(pipelineKey: string, number: number): string {
  return `${pipelineKey}-${number}`;
}

export function parseLeadKey(raw: string): { key: string; number: number } | null {
  const match = LEAD_KEY.exec(raw.trim());
  const key = match?.[1];
  const number = match?.[2];
  if (key === undefined || number === undefined) return null;
  return { key: key.toUpperCase(), number: Number(number) };
}

function candidates(name: string): string[] {
  const letters = name
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  const seed = letters.length >= 3 ? letters.slice(0, 3) : `${letters}XX`.slice(0, 2);
  const prefix = seed.slice(0, 2);
  const list = [seed];
  if (letters.length >= 4) list.push(letters.slice(0, 4));
  if (letters.length >= 5) list.push(letters.slice(0, 5));
  for (const first of ALPHABET) list.push(`${prefix}${first}`);
  for (const first of ALPHABET) {
    for (const second of ALPHABET) list.push(`${prefix}${first}${second}`);
  }
  return list;
}

export function derivePipelineKey(name: string, taken: ReadonlySet<string>): string {
  const found = candidates(name).find((candidate) => !taken.has(candidate));
  if (found === undefined) throw new Error('Every pipeline key for that name is taken.');
  return found;
}
