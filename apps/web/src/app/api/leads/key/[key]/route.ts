import { getLeadByKey } from '@gravity/core';
import { notFound } from '@gravity/shared/errors';
import { handle } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ key: string }>;
}

function decodedKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw notFound('That lead does not exist.');
  }
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handle(async (principal) => ({
    lead: await getLeadByKey(principal, decodedKey((await params).key)),
  }));
}
