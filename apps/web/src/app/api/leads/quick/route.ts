import { quickCreateLead } from '@gravity/core';
import { readJson } from '@/lib/api/handler.ts';
import { handleWrite } from '@/lib/api/write.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleWrite(
    request,
    async (context) => await quickCreateLead(context, await readJson(request)),
    ({ lead, person, company, personCreated }) => ({ lead, person, company, personCreated }),
  );
}
