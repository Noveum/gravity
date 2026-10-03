import { listLeads } from '@gravity/core';
import { encodeListQuery, leadFilterRegistry } from '@gravity/shared/filters';
import { type DehydratedState, dehydrate, QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { leadViewsFor, resolveListQuery } from '@/features/filters/list-query.ts';
import { bootstrapPayload } from '@/lib/api/bootstrap.ts';
import type { ApiContext } from '@/lib/api/handler.ts';
import { queryKeys } from './keys.ts';
import { bootstrapSchema, leadPageSchema } from './schemas.ts';

function asWire<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(payload)));
}

export async function dehydratedBootstrap(context: ApiContext): Promise<DehydratedState> {
  const client = new QueryClient();
  client.setQueryData(
    queryKeys.bootstrap,
    asWire(bootstrapSchema, await bootstrapPayload(context)),
  );
  return dehydrate(client);
}

export async function dehydratedLeads(
  context: ApiContext,
  pipelineKey: string,
  rawSearch: string,
): Promise<DehydratedState> {
  const client = new QueryClient();
  const bootstrap = asWire(bootstrapSchema, await bootstrapPayload(context));
  client.setQueryData(queryKeys.bootstrap, bootstrap);
  const pipeline = bootstrap.pipelines.find((entry) => entry.key === pipelineKey.toUpperCase());
  if (pipeline !== undefined) {
    const fields = bootstrap.fields.filter(
      (field) =>
        field.object === 'lead' && (field.pipelineId === null || field.pipelineId === pipeline.id),
    );
    const query = resolveListQuery(
      rawSearch,
      leadViewsFor(bootstrap.savedViews, pipeline.id),
      leadFilterRegistry(fields, pipeline.id),
    );
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
