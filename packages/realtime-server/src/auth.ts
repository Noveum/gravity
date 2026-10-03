import { and, db, eq, gt, inArray, isNull, schema, sql } from '@gravity/db';
import { ORG_ROLES, type OrgRole } from '@gravity/shared/constants';
import { authMessageSchema, parseScope } from '@gravity/shared/events';
import { type RealtimeTicketPayload, verifyRealtimeTicket } from '@gravity/shared/events/ticket';
import { z } from 'zod';

export interface ConnectionPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly name: string;
  readonly image: string | null;
  readonly organizationId: string;
  readonly role: OrgRole;
}

const roleSchema = z.enum(ORG_ROLES).catch('guest');

interface SessionUser {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
}

function toPrincipal(
  user: SessionUser,
  membership: { readonly organizationId: string; readonly role: string },
  sessionId: string,
): ConnectionPrincipal {
  return {
    userId: user.userId,
    sessionId,
    name: user.name,
    image: user.image,
    organizationId: membership.organizationId,
    role: roleSchema.parse(membership.role),
  };
}

export type ConnectionRejection = 'unauthorized' | 'organization_forbidden';

export type ConnectionAuthentication =
  | { readonly ok: true; readonly principal: ConnectionPrincipal }
  | { readonly ok: false; readonly reason: ConnectionRejection };

export function readTicketFrame(
  raw: string,
  secret: string,
  now?: number,
): RealtimeTicketPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = authMessageSchema.safeParse(parsed);
  if (!frame.success) return null;
  return verifyRealtimeTicket(frame.data.ticket, secret, now);
}

export async function authenticateTicket(
  payload: RealtimeTicketPayload,
): Promise<ConnectionAuthentication> {
  const sessions = await db
    .select({
      userId: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(
      and(
        eq(schema.session.id, payload.sessionId),
        eq(schema.session.userId, payload.userId),
        gt(schema.session.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const found = sessions[0];
  if (found === undefined) return { ok: false, reason: 'unauthorized' };

  const memberships = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.userId, found.userId),
        eq(schema.member.organizationId, payload.organizationId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);

  const membership = memberships[0];
  if (membership === undefined) return { ok: false, reason: 'organization_forbidden' };

  return {
    ok: true,
    principal: toPrincipal(
      found,
      { organizationId: payload.organizationId, role: membership.role },
      payload.sessionId,
    ),
  };
}

export const memberDeleteSchema = z.object({ userId: z.string().min(1) });

export async function liveSessionIds(sessionIds: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(sessionIds)];
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(and(inArray(schema.session.id, wanted), gt(schema.session.expiresAt, new Date())));
  return new Set(rows.map((row) => row.id));
}

export async function sessionStillValid(sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(and(eq(schema.session.id, sessionId), gt(schema.session.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

export async function membershipStillValid(principal: ConnectionPrincipal): Promise<boolean> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function refreshedPrincipal(
  principal: ConnectionPrincipal,
): Promise<ConnectionPrincipal | null> {
  const rows = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (membership === undefined) return null;
  return { ...principal, role: roleSchema.parse(membership.role) };
}

const RECORD_TABLES = {
  brand: 'brand',
  pipeline: 'pipeline',
  person: 'person',
  company: 'company',
} as const;

type RecordScopeKind = keyof typeof RECORD_TABLES;

async function recordInOrganization(
  kind: RecordScopeKind,
  id: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from ${sql.identifier(RECORD_TABLES[kind])} where id = ${id} and organization_id = ${organizationId} and archived_at is null limit 1`,
  );
  return rows.length > 0;
}

export async function authorizeScope(
  principal: ConnectionPrincipal,
  scope: string,
): Promise<boolean> {
  const parsed = parseScope(scope);
  if (parsed === null) return false;
  switch (parsed.kind) {
    case 'workspace':
      return parsed.id === principal.organizationId;
    case 'user':
      return parsed.id === principal.userId;
    case 'brand':
    case 'pipeline':
    case 'person':
    case 'company':
      return await recordInOrganization(parsed.kind, parsed.id, principal.organizationId);
  }
}
