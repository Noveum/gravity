import { endEmployment } from '@gravity/core';
import { routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await endEmployment(context, routeId((await params).id, 'job')),
    ({ employment }) => ({ employment }),
  );
}
