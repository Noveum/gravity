import { listPeople, upsertPerson } from '@gravity/core';
import { handle, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => await listPeople(principal, searchParamsOf(request)));
}

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await upsertPerson(context, await readJson(request)),
    ({ person, company, created, matchedBy }) => ({ person, company, created, matchedBy }),
  );
}
