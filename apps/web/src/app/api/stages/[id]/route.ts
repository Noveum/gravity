import { archiveStage, updateStage } from '@gravity/core';
import { readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updateStage(context, routeId((await params).id, 'stage'), await readJson(request)),
    ({ stage }) => ({ stage }),
  );
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await archiveStage(context, routeId((await params).id, 'stage')),
    ({ stage }) => ({ stage }),
  );
}
