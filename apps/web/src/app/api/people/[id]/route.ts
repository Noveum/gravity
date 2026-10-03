import { getPersonRecord, updatePerson } from '@gravity/core';
import { handle, readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handle(
    async (principal) => await getPersonRecord(principal, routeId((await params).id, 'person')),
  );
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updatePerson(context, routeId((await params).id, 'person'), await readJson(request)),
    ({ person }) => ({ person }),
  );
}
