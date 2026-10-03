import { reorderStages } from '@gravity/core';
import { readJson } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await reorderStages(context, await readJson(request)),
    ({ stages }) => ({ stages }),
  );
}
