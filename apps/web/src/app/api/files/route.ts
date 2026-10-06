import { createFile, listFiles } from '@gravity/core';
import { handle, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => await listFiles(principal, searchParamsOf(request)));
}

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await createFile(context, await readJson(request)),
    ({ entries }) => ({ entries }),
  );
}
