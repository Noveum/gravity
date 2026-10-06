import { startFileUpload } from '@gravity/core';
import { handle, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  return await handle(
    async (principal) => await startFileUpload(principal, await readJson(request)),
  );
}
