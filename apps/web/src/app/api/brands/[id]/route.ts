import { archiveBrand, updateBrand } from '@gravity/core';
import { readJson, routeId } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updateBrand(context, routeId((await params).id, 'brand'), await readJson(request)),
    ({ brand }) => ({ brand }),
  );
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await archiveBrand(context, routeId((await params).id, 'brand')),
    ({ brand }) => ({ brand }),
  );
}
