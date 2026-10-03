import { changeLead, getLead } from '@gravity/core';
import { handle, readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handle(async (principal) => ({
    lead: await getLead(principal, routeId((await params).id, 'lead')),
  }));
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await changeLead(context, routeId((await params).id, 'lead'), await readJson(request)),
    ({ lead }) => ({ lead }),
  );
}
