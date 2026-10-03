import { createLead, listLeads } from '@gravity/core';
import { handle, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => await listLeads(principal, searchParamsOf(request)));
}

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await createLead(context, await readJson(request)),
    ({ lead }) => ({ lead }),
  );
}
