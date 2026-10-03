import { archivePipeline, updatePipeline } from '@gravity/core';
import { readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updatePipeline(
        context,
        routeId((await params).id, 'pipeline'),
        await readJson(request),
      ),
    ({ pipeline }) => ({ pipeline }),
  );
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await archivePipeline(context, routeId((await params).id, 'pipeline')),
    ({ pipeline }) => ({ pipeline }),
  );
}
