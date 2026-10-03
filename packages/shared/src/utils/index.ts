import { v7 as uuidv7 } from 'uuid';

export * from './email-configuration.ts';
export * from './email-domain.ts';
export * from './initials.ts';
export * from './relative-time.ts';

export function randomUUIDv7(at?: Date): string {
  return at === undefined ? uuidv7() : uuidv7({ msecs: at.getTime() });
}
