import { getFile, updateFile } from '@gravity/core';
import { fileIdSchema } from '@gravity/shared/validators';
import { handle, readJson } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return await handle(
    async (principal) =>
      await getFile(
        principal,
        fileIdSchema.parse((await params).id),
        new URL(request.url).searchParams.get('metadata') === 'true',
      ),
  );
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return await handleWrite(
    request,
    async (context) =>
      await updateFile(context, fileIdSchema.parse((await params).id), await readJson(request)),
    ({ entries }) => ({ entries }),
  );
}
