import { assertWithinRequestRateLimit, commitImport } from '@gravity/core';
import { assertCan } from '@gravity/shared/policy';
import { apiContext, handleRoute, publish } from '@/lib/api/handler.ts';
import {
  IMPORT_COMMIT_BUDGET_MS,
  IMPORT_COMMIT_RATE,
  importRateKey,
  readImportBody,
} from '@/lib/api/imports.ts';
import { originClientIdOf } from '@/lib/api/write.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const deadline = Date.now() + IMPORT_COMMIT_BUDGET_MS;
  return await handleRoute(async () => {
    const context = await apiContext();
    assertCan(context.principal, 'import:run');
    const body = await readImportBody(request);
    await assertWithinRequestRateLimit(
      importRateKey('commit', context.principal),
      IMPORT_COMMIT_RATE,
      'You have started many imports in the last hour.',
    );
    const report = await commitImport(
      { principal: context.principal, originClientId: originClientIdOf(request) },
      body,
      { actorName: context.userName, publish, deadline },
    );
    return { report };
  });
}
