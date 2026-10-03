import { createHash } from 'node:crypto';
import {
  listBrands,
  listFieldDefinitions,
  listMembers,
  listPipelines,
  listSavedViews,
  listStages,
  listViewPreferences,
  memberRowOf,
} from '@gravity/core';
import { db, sql } from '@gravity/db';
import type { Bootstrap } from '@/lib/query/schemas.ts';
import type { ApiContext } from './handler.ts';

export async function bootstrapVersion(context: ApiContext): Promise<string> {
  const { organizationId, userId, role } = context.principal;
  const rows = await db.execute<{ fingerprint: string | null }>(sql`
    select concat_ws('|',
      coalesce((select string_agg(id || ':' || sync_id, ',' order by id) from brand where organization_id = ${organizationId} and archived_at is null), ''),
      coalesce((select string_agg(id || ':' || sync_id, ',' order by id) from pipeline where organization_id = ${organizationId} and archived_at is null), ''),
      coalesce((select string_agg(id || ':' || sync_id, ',' order by id) from stage where organization_id = ${organizationId} and archived_at is null), ''),
      coalesce((select string_agg(id || ':' || sync_id, ',' order by id) from field_definition where organization_id = ${organizationId} and archived_at is null), ''),
      coalesce((select string_agg(m.id || ':' || m.sync_id || ':' || u.name || ':' || u.email || ':' || coalesce(u.image, ''), ',' order by m.id) from member m join "user" u on u.id = m.user_id where m.organization_id = ${organizationId}), ''),
      coalesce((select string_agg(id || ':' || sync_id, ',' order by id) from saved_view where organization_id = ${organizationId} and (visibility = 'workspace' or owner_id = ${userId})), ''),
      coalesce((select string_agg(page || ':' || scope || ':' || md5(layout || ':' || display::text), ',' order by page, scope) from view_preference where organization_id = ${organizationId} and user_id = ${userId}), ''),
      coalesce((select name || ':' || slug from organization where id = ${organizationId}), '')
    ) as fingerprint
  `);
  const digest = createHash('sha256')
    .update(rows[0]?.fingerprint ?? '')
    .digest('base64url')
    .slice(0, 22);
  return `${userId}.${role}.${digest}`;
}

export async function bootstrapPayload(context: ApiContext): Promise<Bootstrap> {
  const principal = context.principal;
  const [brands, pipelines, stages, fields, members, savedViews, viewPreferences] =
    await Promise.all([
      listBrands(principal),
      listPipelines(principal),
      listStages(principal),
      listFieldDefinitions(principal),
      listMembers(principal),
      listSavedViews(principal),
      listViewPreferences(principal),
    ]);
  return {
    organization: {
      id: principal.organizationId,
      name: context.organizationName,
      slug: context.organizationSlug,
    },
    me: { userId: principal.userId, role: principal.role },
    brands,
    pipelines,
    stages,
    fields,
    members: members.map(memberRowOf),
    savedViews,
    viewPreferences,
  };
}
