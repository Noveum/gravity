import { createBrand } from '@gravity/core';
import { readJson } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await createBrand(context, await readJson(request)),
    ({ brand, pipeline, stages }) => ({ brand, pipeline, stages }),
  );
}
