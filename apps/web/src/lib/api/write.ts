import type { WriteContext } from '@gravity/core';
import {
  ORIGIN_CLIENT_ID_HEADER,
  originClientIdSchema,
  type SyncAction,
} from '@gravity/shared/events';
import { apiContext, handleRoute, publish } from './handler.ts';

export function originClientIdOf(request: Request): string | undefined {
  const parsed = originClientIdSchema.safeParse(request.headers.get(ORIGIN_CLIENT_ID_HEADER));
  return parsed.success ? parsed.data : undefined;
}

export async function writeContextFor(request: Request): Promise<WriteContext> {
  const { principal } = await apiContext();
  return { principal, originClientId: originClientIdOf(request) };
}

export async function handleWrite<T extends { readonly actions: readonly SyncAction[] }>(
  request: Request,
  run: (context: WriteContext) => Promise<T>,
  present: (result: T) => unknown,
): Promise<Response> {
  return await handleRoute(async () => {
    const result = await run(await writeContextFor(request));
    await publish(result.actions);
    return present(result);
  });
}
