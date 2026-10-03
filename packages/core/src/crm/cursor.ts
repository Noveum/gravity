import { validationFailed } from '@gravity/shared/errors';
import { z } from 'zod';

export type CursorValue = string | number;

const cursorSchema = z
  .array(z.union([z.string(), z.number()]))
  .min(1)
  .max(4);

export function encodeCursor(values: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

function parseCursor(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function decodeCursor(raw: string, length: number): CursorValue[] {
  const parsed = cursorSchema.safeParse(parseCursor(raw));
  if (!parsed.success || parsed.data.length !== length) {
    throw validationFailed('That page cursor is not valid. Reload the list.');
  }
  return parsed.data;
}
