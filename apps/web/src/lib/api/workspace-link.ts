import { and, db, eq, isNull, schema } from '@gravity/db';
import { WORKSPACE_LINK_PARAM } from '@gravity/shared/utils';
import { notFound, redirect } from 'next/navigation';
import { type ApiContext, pageContext } from '@/lib/api/handler.ts';

export const WORKSPACE_LINK_PATH = '/api/workspace-link';

export type PageSearchParams = Record<string, string | string[] | undefined>;

export async function memberWorkspaceBySlug(userId: string, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: schema.organization.id })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.organization.slug, slug),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  return row?.organizationId ?? null;
}

export function linkedSlugOf(searchParams: PageSearchParams): string | null {
  const raw = searchParams[WORKSPACE_LINK_PARAM];
  if (raw === undefined) return null;
  if (typeof raw !== 'string') notFound();
  const slug = raw.trim().toLowerCase();
  return slug.length === 0 ? null : slug;
}

export function pathWithQuery(pathname: string, searchParams: PageSearchParams): string {
  const query = new URLSearchParams(
    Object.entries(searchParams).flatMap(([name, value]) =>
      typeof value === 'string' ? [[name, value]] : [],
    ),
  ).toString();
  return query.length === 0 ? pathname : `${pathname}?${query}`;
}

export async function linkedPageContext(
  pathname: string,
  searchParams: PageSearchParams,
): Promise<ApiContext> {
  const context = await pageContext();
  const slug = linkedSlugOf(searchParams);
  if (slug === null || slug === context.organizationSlug.toLowerCase()) return context;
  const organizationId = await memberWorkspaceBySlug(context.principal.userId, slug);
  if (organizationId === null) notFound();
  const next = pathWithQuery(pathname, searchParams);
  redirect(`${WORKSPACE_LINK_PATH}?${new URLSearchParams({ w: slug, next }).toString()}`);
}
