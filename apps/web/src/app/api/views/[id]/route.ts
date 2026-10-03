import { deleteSavedView, updateSavedView } from '@gravity/core';
import { readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updateSavedView(context, routeId((await params).id, 'view'), await readJson(request)),
    ({ view }) => ({ view }),
  );
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await deleteSavedView(context, routeId((await params).id, 'view')),
    ({ id }) => ({ id }),
  );
}
