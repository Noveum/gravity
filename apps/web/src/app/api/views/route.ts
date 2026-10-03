import { createSavedView } from '@gravity/core';
import { readJson } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await createSavedView(context, await readJson(request)),
    ({ view }) => ({ view }),
  );
}
