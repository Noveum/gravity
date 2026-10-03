import { saveViewPreference } from '@gravity/core';
import { handle, readJson } from '@/lib/api/handler.ts';

export async function PUT(request: Request): Promise<Response> {
  return await handle(async (principal) => ({
    preference: await saveViewPreference(principal, await readJson(request)),
  }));
}
