import { unarchiveStage } from '@gravity/core';
import { routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await unarchiveStage(context, routeId((await params).id, 'stage')),
    ({ stage }) => ({ stage }),
  );
}
