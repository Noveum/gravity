import { and, asc, db, eq, schema } from '@gravity/db';
import { internal } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import { type ViewPreferenceRow, viewPreferenceRowSchema } from '@gravity/shared/records';
import { viewPreferenceSchema } from '@gravity/shared/validators';
import { newId } from '../internal.ts';

export async function listViewPreferences(principal: Principal): Promise<ViewPreferenceRow[]> {
  assertCan(principal, 'record:read');
  const rows = await db
    .select({
      page: schema.viewPreference.page,
      scope: schema.viewPreference.scope,
      layout: schema.viewPreference.layout,
      display: schema.viewPreference.display,
    })
    .from(schema.viewPreference)
    .where(
      and(
        eq(schema.viewPreference.userId, principal.userId),
        eq(schema.viewPreference.organizationId, principal.organizationId),
      ),
    )
    .orderBy(asc(schema.viewPreference.page), asc(schema.viewPreference.scope));
  return rows.map((row) => viewPreferenceRowSchema.parse(row));
}

export async function saveViewPreference(
  principal: Principal,
  input: unknown,
): Promise<ViewPreferenceRow> {
  assertCan(principal, 'record:read');
  const parsed = viewPreferenceSchema.parse(input);

  const [row] = await db
    .insert(schema.viewPreference)
    .values({
      id: newId(),
      organizationId: principal.organizationId,
      userId: principal.userId,
      page: parsed.page,
      scope: parsed.scope,
      layout: parsed.layout,
      display: parsed.display,
    })
    .onConflictDoUpdate({
      target: [
        schema.viewPreference.userId,
        schema.viewPreference.organizationId,
        schema.viewPreference.page,
        schema.viewPreference.scope,
      ],
      set: { layout: parsed.layout, display: parsed.display, updatedAt: new Date() },
    })
    .returning({
      page: schema.viewPreference.page,
      scope: schema.viewPreference.scope,
      layout: schema.viewPreference.layout,
      display: schema.viewPreference.display,
    });

  if (row === undefined) throw internal('The view preference did not save.');
  return viewPreferenceRowSchema.parse(row);
}
