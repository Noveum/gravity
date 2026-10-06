import { transferFiles } from '@gravity/core';
import { readJson } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await transferFiles(context, await readJson(request)),
    ({ entries }) => ({ entries }),
  );
}
