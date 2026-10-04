export interface Violation {
  readonly code: string | null;
  readonly constraint: string | null;
}

const NO_VIOLATION: Violation = { code: null, constraint: null };

function stringProperty(source: object, key: string): string | null {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' ? value : null;
}

function failureOf(error: unknown): Violation {
  let cursor: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof cursor !== 'object' || cursor === null) break;
    const code = stringProperty(cursor, 'code');
    if (code !== null && /^\d{5}$/.test(code)) {
      return { code, constraint: stringProperty(cursor, 'constraint_name') };
    }
    cursor = Reflect.get(cursor, 'cause');
  }
  return NO_VIOLATION;
}

export async function violation(run: () => Promise<unknown>): Promise<Violation> {
  try {
    await run();
  } catch (error: unknown) {
    return failureOf(error);
  }
  return NO_VIOLATION;
}
