import { listMembers } from '@gravity/core';
import { handle } from '@/lib/api/handler.ts';

export async function GET(_request: Request): Promise<Response> {
  return await handle(async (principal) => ({ members: await listMembers(principal) }));
}
