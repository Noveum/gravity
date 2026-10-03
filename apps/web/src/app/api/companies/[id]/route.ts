import { getCompanyRecord, updateCompany } from '@gravity/core';
import { handle, readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handle(
    async (principal) => await getCompanyRecord(principal, routeId((await params).id, 'company')),
  );
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updateCompany(context, routeId((await params).id, 'company'), await readJson(request)),
    ({ company }) => ({ company }),
  );
}
