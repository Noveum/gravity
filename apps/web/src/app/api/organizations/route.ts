import { createOrganization, listOrganizationsForUser } from '@gravity/core';
import { unauthorized } from '@gravity/shared/errors';
import { headers } from 'next/headers';
import { handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function GET(_request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const rows = await listOrganizationsForUser(session.user.id);
    return {
      organizations: rows.map((row) => ({
        id: row.organization.id,
        name: row.organization.name,
        slug: row.organization.slug,
        logo: row.organization.logo,
        role: row.role,
      })),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const created = await createOrganization(session.user.id, await readJson(request));
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: created.organization.id },
    });
    await publish(created.actions);
    return {
      organization: {
        id: created.organization.id,
        name: created.organization.name,
        slug: created.organization.slug,
      },
    };
  });
}
