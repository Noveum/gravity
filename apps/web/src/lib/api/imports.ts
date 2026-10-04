import { payloadTooLarge, validationFailed } from '@gravity/shared/errors';
import { decodeImportBytes, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@gravity/shared/import';
import { readCappedBytes } from './capped-body.ts';

export const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_BYTES * 2 + 100_000;
export const IMPORT_PREVIEW_RATE = { window: 3600, max: 120 } as const;
export const IMPORT_COMMIT_RATE = { window: 3600, max: 20 } as const;

const TOO_LARGE =
  'This file is too large to import here. Import files up to 2.0 MB, or use bun run import.';

const REQUEST_LIMITS = { maxBytes: MAX_IMPORT_REQUEST_BYTES, maxRows: MAX_IMPORT_ROWS } as const;

export async function readImportBody(request: Request): Promise<unknown> {
  const bytes = await readCappedBytes(request, MAX_IMPORT_REQUEST_BYTES);
  if (bytes === null) throw payloadTooLarge(TOO_LARGE);
  try {
    return JSON.parse(decodeImportBytes(bytes, REQUEST_LIMITS)) as unknown;
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      throw validationFailed('That request body is not valid JSON.');
    throw error;
  }
}

export function importRateKey(
  kind: 'preview' | 'commit',
  principal: { readonly organizationId: string; readonly userId: string },
): string {
  return `import:${kind}:${principal.organizationId}:${principal.userId}`;
}
