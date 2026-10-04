import { getRecordContext, renderRecordContext, resolveRecordRef } from '@gravity/core';
import { recordLinks } from '@gravity/shared/utils';
import { contextQuerySchema } from '@gravity/shared/validators';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';
import { publicAppUrl } from '@/lib/env.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = contextQuerySchema.parse(searchParamsOf(request));
    const links = recordLinks(publicAppUrl());
    const subject = await resolveRecordRef(principal, query.ref, { links });
    const context = await getRecordContext(principal, subject);
    return { subject, text: renderRecordContext(context, { maxTokens: query.maxTokens, links }) };
  });
}
