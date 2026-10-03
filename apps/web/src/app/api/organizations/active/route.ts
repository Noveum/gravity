import { findPrincipal } from '@gravity/core';
import { forbidden, unauthorized } from '@gravity/shared/errors';
import { idSchema } from '@gravity/shared/validators';
import { headers } from 'next/headers';
import { z } from 'zod';
import { handleRoute, readJson } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

const switchWorkspaceSchema = z.object({ organizationId: idSchema });

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const { organizationId } = switchWorkspaceSchema.parse(await readJson(request));
    const principal = await findPrincipal(session.user.id, organizationId);
    if (principal === null) throw forbidden('You are not a member of this workspace.');
    await auth.api.setActiveOrganization({ headers: await headers(), body: { organizationId } });
    return { organizationId };
  });
}
