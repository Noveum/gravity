import { archiveFieldDefinition, updateFieldDefinition } from '@gravity/core';
import { readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updateFieldDefinition(
        context,
        routeId((await params).id, 'custom field'),
        await readJson(request),
      ),
    ({ field }) => ({ field }),
  );
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await archiveFieldDefinition(context, routeId((await params).id, 'custom field')),
    ({ field }) => ({ field }),
  );
}
