import { and, asc, db, eq, isNull, or, schema } from '@gravity/db';
import { conflict, forbidden } from '@gravity/shared/errors';
import type { SyncAction } from '@gravity/shared/events';
import { scopes } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import { emailDomain, normalizeDomains, parseDomainList } from '@gravity/shared/utils';
import { organizationCreateSchema, organizationUpdateSchema } from '@gravity/shared/validators';
import { principalActor } from '../actor.ts';
import { cappedTransaction } from '../crm/sync-batch.ts';
import { newId, requireRow } from '../internal.ts';
import { recordSync } from '../realtime/outbox.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type OrganizationRow = typeof schema.organization.$inferSelect;
export type MemberRow = typeof schema.member.$inferSelect;

export interface OrganizationBootstrap {
  readonly organization: OrganizationRow;
  readonly member: MemberRow;
  readonly actions: SyncAction[];
}

type OrganizationUpdate = ReturnType<typeof organizationUpdateSchema.parse>;

function organizationUpdateValues(
  parsed: OrganizationUpdate,
): Partial<typeof schema.organization.$inferInsert> {
  return {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.logo === undefined ? {} : { logo: parsed.logo }),
    ...(parsed.allowedEmailDomains === undefined
      ? {}
      : { allowedEmailDomains: parsed.allowedEmailDomains }),
  };
}

export interface CreateOrganizationOptions {
  readonly metadata?: string;
}

export async function createOrganization(
  userId: string,
  input: unknown,
  options: CreateOrganizationOptions = {},
): Promise<OrganizationBootstrap> {
  const parsed = organizationCreateSchema.parse(input);

  return await cappedTransaction(async (tx) => {
    const [taken] = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, parsed.slug))
      .limit(1);
    if (taken !== undefined) throw conflict('That workspace address is already taken.');

    const organizationSyncId = await nextSyncId(tx);
    const memberSyncId = await nextSyncId(tx);
    const [createdOrg] = await tx
      .insert(schema.organization)
      .values({
        id: newId(),
        name: parsed.name,
        slug: parsed.slug,
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
        syncId: organizationSyncId,
      })
      .returning();
    const organization = requireRow(createdOrg, 'The workspace could not be created.');

    const [createdMember] = await tx
      .insert(schema.member)
      .values({
        id: newId(),
        organizationId: organization.id,
        userId,
        role: 'admin',
        syncId: memberSyncId,
      })
      .returning();
    const member = requireRow(createdMember, 'The owner membership could not be created.');

    const actor = principalActor({ userId, organizationId: organization.id, role: 'admin' });
    const actions: SyncAction[] = [
      buildSyncAction({
        syncId: organizationSyncId,
        organizationId: organization.id,
        scopes: [scopes.workspace(organization.id), scopes.user(userId)],
        action: 'insert',
        model: 'organization',
        modelId: organization.id,
        data: organization,
        actor,
      }),
      buildSyncAction({
        syncId: memberSyncId,
        organizationId: organization.id,
        scopes: [scopes.workspace(organization.id), scopes.user(userId)],
        action: 'insert',
        model: 'member',
        modelId: member.id,
        data: member,
        actor,
      }),
    ];
    await recordSync(tx, actions);

    return { organization, member, actions };
  });
}

export async function updateOrganization(
  principal: Principal,
  input: unknown,
): Promise<{ organization: OrganizationRow; actions: SyncAction[] }> {
  assertCan(principal, 'workspace:manage');
  const parsed = organizationUpdateSchema.parse(input);

  return await cappedTransaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const [updated] = await tx
      .update(schema.organization)
      .set({ ...organizationUpdateValues(parsed), syncId })
      .where(eq(schema.organization.id, principal.organizationId))
      .returning();
    const organization = requireRow(updated, 'That workspace does not exist.');

    const actions = [
      buildSyncAction({
        syncId,
        organizationId: organization.id,
        scopes: [scopes.workspace(organization.id)],
        action: 'update',
        model: 'organization',
        modelId: organization.id,
        data: organization,
        actor: principalActor(principal),
      }),
    ];
    await recordSync(tx, actions);

    return { organization, actions };
  });
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationRow> {
  const [row] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return requireRow(row, 'That workspace does not exist.');
}

export async function getOrganization(organizationId: string): Promise<OrganizationRow> {
  const [row] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return requireRow(row, 'That workspace does not exist.');
}

export async function listOrganizationsForUser(
  userId: string,
  options: { readonly includeDeletingForAdmins?: boolean } = {},
): Promise<{ organization: OrganizationRow; role: string }[]> {
  const visibleOrganization =
    options.includeDeletingForAdmins === true
      ? or(isNull(schema.organization.deletionRequestedAt), eq(schema.member.role, 'admin'))
      : isNull(schema.organization.deletionRequestedAt);
  const rows = await db
    .select({ organization: schema.organization, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), visibleOrganization))
    .orderBy(asc(schema.organization.name));
  return rows;
}

export { emailDomain };

export function matchAllowedDomain(
  organization: Pick<OrganizationRow, 'allowedEmailDomains'>,
  email: string,
): string | null {
  const domain = emailDomain(email);
  if (domain === null) return null;
  const allowed = normalizeDomains(organization.allowedEmailDomains);
  return allowed.includes(domain) ? domain : null;
}

export function configuredEmailDomains(): string[] {
  return parseDomainList(process.env['ALLOWED_EMAIL_DOMAINS'], 'ALLOWED_EMAIL_DOMAINS');
}

export function assertEmailDomainAllowed(
  email: string,
  organization: Pick<OrganizationRow, 'allowedEmailDomains'> | null = null,
): void {
  const domain = emailDomain(email);
  const lists = [
    configuredEmailDomains(),
    normalizeDomains(organization?.allowedEmailDomains ?? []),
  ];
  for (const allowed of lists) {
    if (allowed.length === 0) continue;
    if (domain !== null && allowed.includes(domain)) continue;
    throw forbidden(`${domain ?? email} is not an allowed email domain.`, {
      details: { domain, allowed },
    });
  }
}

export async function findOrganizationsForEmailDomain(email: string): Promise<OrganizationRow[]> {
  const rows = await db.select().from(schema.organization);
  return rows.filter((row) => matchAllowedDomain(row, email) !== null);
}

export async function getMembership(
  organizationId: string,
  userId: string,
): Promise<MemberRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  return row;
}
