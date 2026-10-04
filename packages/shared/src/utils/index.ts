import { v7 as uuidv7 } from 'uuid';

export * from './email-configuration.ts';
export * from './email-domain.ts';
export * from './error-fields.ts';
export * from './identity.ts';
export * from './initials.ts';
export * from './logo-uri.ts';
export * from './pipeline-key.ts';
export * from './record-links.ts';
export * from './redirect-uri.ts';
export * from './relative-time.ts';
export * from './slug.ts';

export function randomUUIDv7(at?: Date): string {
  return at === undefined ? uuidv7() : uuidv7({ msecs: at.getTime() });
}
