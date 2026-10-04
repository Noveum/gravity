import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeCallback } from '@/app/(auth)/login/continue-url.ts';
import { memberWorkspaceBySlug } from '@/lib/api/workspace-link.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const next = safeCallback(search.get('next') ?? undefined);
  const session = await getSession();
  if (session === null) redirect(`/login?${new URLSearchParams({ next }).toString()}`);
  const slug = (search.get('w') ?? '').trim().toLowerCase();
  const organizationId =
    slug.length === 0 ? null : await memberWorkspaceBySlug(session.user.id, slug);
  if (organizationId === null) return new Response('Not Found', { status: 404 });
  await auth.api.setActiveOrganization({ headers: await headers(), body: { organizationId } });
  redirect(next);
}
