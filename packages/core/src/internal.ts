import { createHash, randomUUID } from 'node:crypto';
import type { Database, Transaction } from '@gravity/db';
import { notFound } from '@gravity/shared/errors';
import { randomUUIDv7 } from '@gravity/shared/utils';

export type Executor = Database | Transaction;

export function newId(): string {
  return randomUUIDv7();
}

export function newToken(): string {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) throw notFound(message);
  return row;
}

const UNIQUE_VIOLATION = '23505';
const CAUSE_DEPTH = 5;

export function uniqueViolationOf(error: unknown): Record<string, unknown> | null {
  let cursor: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH; depth += 1) {
    if (typeof cursor !== 'object' || cursor === null) return null;
    if ('code' in cursor && cursor.code === UNIQUE_VIOLATION) return { ...cursor };
    cursor = 'cause' in cursor ? cursor.cause : undefined;
  }
  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return uniqueViolationOf(error) !== null;
}

export function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}
