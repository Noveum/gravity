import { and, db, eq, isNull, schema } from '@gravity/db';
import { assertCan, type Principal } from '@gravity/shared/policy';

export interface CurrentPlaybook {
  readonly brandId: string;
  readonly version: number;
  readonly body: string;
}

export async function listCurrentPlaybooks(principal: Principal): Promise<CurrentPlaybook[]> {
  assertCan(principal, 'record:read');
  return await db
    .select({
      brandId: schema.playbookVersion.brandId,
      version: schema.playbookVersion.version,
      body: schema.playbookVersion.body,
    })
    .from(schema.playbookVersion)
    .innerJoin(
      schema.brand,
      and(
        eq(schema.brand.id, schema.playbookVersion.brandId),
        eq(schema.brand.currentPlaybookVersion, schema.playbookVersion.version),
      ),
    )
    .where(
      and(
        eq(schema.playbookVersion.organizationId, principal.organizationId),
        eq(schema.brand.organizationId, principal.organizationId),
        isNull(schema.brand.archivedAt),
      ),
    )
    .orderBy(schema.brand.name);
}
