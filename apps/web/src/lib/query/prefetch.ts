import { listLeads } from '@gravity/core';
import { encodeListQuery, type ListQuery } from '@gravity/shared/filters';
import { type DehydratedState, dehydrate, QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { bootstrapPayload } from '@/lib/api/bootstrap.ts';
import type { ApiContext } from '@/lib/api/handler.ts';
import { queryKeys } from './keys.ts';
import { bootstrapSchema, leadPageSchema } from './schemas.ts';

function asWire<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(payload)));
}

export async function dehydratedLeads(
  context: ApiContext,
  pipelineKey: string,
  query: ListQuery,
): Promise<DehydratedState> {
  const client = new QueryClient();
  const bootstrap = asWire(bootstrapSchema, await bootstrapPayload(context));
  client.setQueryData(queryKeys.bootstrap, bootstrap);
  const pipeline = bootstrap.pipelines.find((entry) => entry.key === pipelineKey.toUpperCase());
  if (pipeline !== undefined) {
    const search = encodeListQuery(query);
    const params = Object.fromEntries(new URLSearchParams(search).entries());
    try {
      const page = asWire(
        leadPageSchema,
        await listLeads(context.principal, { ...params, pipelineId: pipeline.id }),
      );
      client.setQueryData(queryKeys.leads(pipeline.id, search), {
        pages: [page],
        pageParams: [null],
      });
    } catch (error: unknown) {
      console.error('Could not prefetch the lead list; the client will load it.', error);
    }
  }
  return dehydrate(client);
}
