import { searchRecords } from '@gravity/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => await searchRecords(principal, searchParamsOf(request)));
}
