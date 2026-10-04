import { assertWithinRequestRateLimit, previewImport } from '@gravity/core';
import { assertCan } from '@gravity/shared/policy';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';
import { IMPORT_PREVIEW_RATE, importRateKey, readImportBody } from '@/lib/api/imports.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'import:run');
    await assertWithinRequestRateLimit(
      importRateKey('preview', principal),
      IMPORT_PREVIEW_RATE,
      'You have previewed many imports in the last hour.',
    );
    const body = await readImportBody(request);
    return { report: await previewImport(principal, body) };
  });
}
