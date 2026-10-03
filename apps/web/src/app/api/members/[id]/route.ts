import { getMember, removeMember, updateMemberRole } from '@gravity/core';
import {
  apiContext,
  handleRoute,
  publish,
  readJson,
  revokeSockets,
  routeId,
} from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'member');
    const updated = await updateMemberRole(principal, id, await readJson(request));
    await publish(updated.actions);
    return { member: updated.member };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'member');
    const target = await getMember(principal, id);
    const removed = await removeMember(principal, id);
    await publish(removed.actions);
    await revokeSockets(target.userId);
    return { removed: true };
  });
}
