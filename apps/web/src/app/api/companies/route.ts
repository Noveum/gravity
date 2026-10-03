import { listCompanies, upsertCompany } from '@gravity/core';
import { handle, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => await listCompanies(principal, searchParamsOf(request)));
}

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await upsertCompany(context, await readJson(request)),
    ({ company, created }) => ({ company, created }),
  );
}
