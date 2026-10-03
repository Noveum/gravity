export function union(first: readonly string[], second: readonly string[]): string[] {
  return [...new Set([...first, ...second])];
}

export function lowercased(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}
