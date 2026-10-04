import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, db, desc, eq, gt, isNull, schema } from '@gravity/db';
import { consentedScopes, grantsReads, grantsWrites } from '@gravity/shared/constants';
import { forbidden, notFound, unauthorized, validationFailed } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { z } from 'zod';
import { cappedTransaction } from '../crm/sync-batch.ts';
import { type Executor, newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

const MCP_CREDENTIAL_PREFIX = 'gravity-mcp-v1';
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const MAX_BOUND_CREDENTIAL_LENGTH = 4096;
const CONSENT_CODE_TTL_MS = 600_000;
const RECONNECT = 'Reconnect Gravity to continue.';

function encodedSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodedSegment(value: string): string | null {
  if (!BASE64URL_SEGMENT.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  return encodedSegment(decoded) === value && decoded.length > 0 ? decoded : null;
}

export interface McpCredentialBinding {
  readonly credential: string;
  readonly grantId: string;
}

export function bindMcpCredential(credential: string, grantId: string, secret: string): string {
  const payload = `${MCP_CREDENTIAL_PREFIX}.${encodedSegment(grantId)}.${encodedSegment(credential)}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function unbindMcpCredential(
  credential: string,
  secret: string,
): McpCredentialBinding | null {
  if (credential.length > MAX_BOUND_CREDENTIAL_LENGTH || secret.length === 0) return null;
  const [prefix, grant, token, signature, ...rest] = credential.split('.');
  if (prefix !== MCP_CREDENTIAL_PREFIX || rest.length > 0) return null;
  if (grant === undefined || token === undefined || signature === undefined) return null;
  const expected = createHmac('sha256', secret)
    .update(`${MCP_CREDENTIAL_PREFIX}.${grant}.${token}`)
    .digest('base64url');
  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (
    provided.length !== wanted.length ||
    !timingSafeEqual(new Uint8Array(provided), new Uint8Array(wanted))
  ) {
    return null;
  }
  const grantId = decodedSegment(grant);
  const raw = decodedSegment(token);
  if (grantId === null || raw === null) return null;
  return { credential: raw, grantId };
}

export interface McpAccessContext {
  readonly principal: Principal;
  readonly userId: string;
  readonly clientId: string;
  readonly organizationId: string;
  readonly scopes: string;
}

export async function verifyMcpAccessToken(
  token: string,
  now: Date = new Date(),
): Promise<McpAccessContext> {
  const rejection = unauthorized('That access token is not valid.');
  if (token.trim().length === 0) throw rejection;
  const binding = unbindMcpCredential(token, process.env['BETTER_AUTH_SECRET'] ?? '');
  if (binding === null) throw rejection;
  const [record] = await db
    .select({ token: schema.oauthAccessToken, grant: schema.mcpGrant })
    .from(schema.oauthAccessToken)
    .leftJoin(
      schema.mcpGrant,
      and(
        eq(schema.mcpGrant.id, binding.grantId),
        eq(schema.mcpGrant.clientId, schema.oauthAccessToken.clientId),
        eq(schema.mcpGrant.userId, schema.oauthAccessToken.userId),
      ),
    )
    .where(eq(schema.oauthAccessToken.accessToken, binding.credential))
    .limit(1);
  if (record === undefined) throw rejection;
  if (record.token.accessTokenExpiresAt.getTime() <= now.getTime()) {
    throw unauthorized('That access token has expired.');
  }
  const userId = record.token.userId;
  if (userId === null) throw rejection;
  const grant = record.grant;
  if (grant === null || grant.revokedAt !== null) {
    throw unauthorized(`This connection has been revoked. ${RECONNECT}`);
  }
  const granted = new Set(grant.scopes.split(/\s+/).filter(Boolean));
  if (record.token.scopes.split(/\s+/).some((scope) => scope.length > 0 && !granted.has(scope))) {
    throw unauthorized(`This connection's permissions have changed. ${RECONNECT}`);
  }
  const principal = await resolvePrincipal(userId, grant.organizationId);
  await db.update(schema.mcpGrant).set({ lastUsedAt: now }).where(eq(schema.mcpGrant.id, grant.id));
  return {
    principal,
    userId,
    clientId: record.token.clientId,
    organizationId: grant.organizationId,
    scopes: record.token.scopes,
  };
}

export interface McpClient {
  readonly clientId: string;
  readonly name: string;
  readonly icon: string | null;
}

export async function getMcpClient(clientId: string): Promise<McpClient | null> {
  const [row] = await db
    .select({
      clientId: schema.oauthApplication.clientId,
      name: schema.oauthApplication.name,
      icon: schema.oauthApplication.icon,
    })
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function userHasPasskey(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.passkey.id })
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, userId))
    .limit(1);
  return row !== undefined;
}

export async function passkeyVerifiedWithin(
  userId: string,
  windowMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.passkey.id })
    .from(schema.passkey)
    .where(
      and(
        eq(schema.passkey.userId, userId),
        gt(schema.passkey.lastUsedAt, new Date(now.getTime() - windowMs)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export interface RecordMcpGrantInput {
  readonly clientId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly scopes: string;
}

async function writeMcpGrant(
  executor: Executor,
  input: RecordMcpGrantInput,
  now: Date,
): Promise<string> {
  await resolvePrincipal(input.userId, input.organizationId, executor);
  const grantId = newId();
  await executor
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.clientId, input.clientId),
        eq(schema.oauthAccessToken.userId, input.userId),
      ),
    );
  const [grant] = await executor
    .insert(schema.mcpGrant)
    .values({
      id: grantId,
      clientId: input.clientId,
      userId: input.userId,
      organizationId: input.organizationId,
      scopes: input.scopes,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [schema.mcpGrant.clientId, schema.mcpGrant.userId],
      set: {
        id: grantId,
        organizationId: input.organizationId,
        scopes: input.scopes,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      },
    })
    .returning({ id: schema.mcpGrant.id });
  if (grant === undefined) throw new Error('The MCP grant could not be stored.');
  return grant.id;
}

export async function recordMcpGrant(
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<string> {
  return await cappedTransaction((tx) => writeMcpGrant(tx, input, now));
}

const consentValueSchema = z.looseObject({
  clientId: z.string().min(1),
  redirectURI: z.string().refine((value) => URL.canParse(value)),
  scope: z.array(z.string()),
  userId: z.string().min(1),
  requireConsent: z.boolean().optional(),
  state: z.string().nullable().optional(),
});

type ConsentValue = z.infer<typeof consentValueSchema>;

function invalidRequest() {
  return unauthorized('This authorization request is invalid or has expired.');
}

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

interface ConsentRequest {
  readonly value: ConsentValue;
  readonly client: McpClient;
}

async function consentRequestOf(
  userId: string,
  consentCode: string,
  now: Date,
): Promise<ConsentRequest> {
  const [record] = await db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, consentCode))
    .limit(1);
  if (record === undefined || record.expiresAt.getTime() <= now.getTime()) throw invalidRequest();
  const parsed = consentValueSchema.safeParse(parsedJson(record.value));
  if (!parsed.success) throw invalidRequest();
  if (parsed.data.userId !== userId) {
    throw forbidden('This authorization request belongs to another account.');
  }
  if (parsed.data.requireConsent !== true) throw invalidRequest();
  const client = await getMcpClient(parsed.data.clientId);
  if (client === null) throw invalidRequest();
  return { value: parsed.data, client };
}

export interface PendingMcpConsent {
  readonly clientId: string;
  readonly clientName: string;
  readonly scopes: string[];
}

export async function pendingMcpConsent(
  userId: string,
  consentCode: string,
  now: Date = new Date(),
): Promise<PendingMcpConsent> {
  const { value, client } = await consentRequestOf(userId, consentCode, now);
  return { clientId: value.clientId, clientName: client.name, scopes: value.scope };
}

export type FinalizeMcpConsentInput =
  | { readonly userId: string; readonly consentCode: string; readonly accept: false }
  | {
      readonly userId: string;
      readonly consentCode: string;
      readonly accept: true;
      readonly organizationId: string;
      readonly allowApproval: boolean;
    };

export async function finalizeMcpConsent(
  input: FinalizeMcpConsentInput,
  now: Date = new Date(),
): Promise<{ redirectUri: string; clientId: string; scope: string }> {
  const { value } = await consentRequestOf(input.userId, input.consentCode, now);
  const redirect = new URL(value.redirectURI);
  if (!input.accept) {
    await db
      .delete(schema.verification)
      .where(eq(schema.verification.identifier, input.consentCode));
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'User denied access');
    if (value.state != null) redirect.searchParams.set('state', value.state);
    return {
      redirectUri: redirect.toString(),
      clientId: value.clientId,
      scope: value.scope.join(' '),
    };
  }
  const granted = consentedScopes(value.scope, input.allowApproval);
  const scope = granted.join(' ');
  if (!(grantsReads(scope) || grantsWrites(scope))) {
    throw validationFailed(
      'This client asked for no Gravity access, so there is nothing to approve. Start the connection again from your client.',
    );
  }
  const code = randomBytes(24).toString('base64url');
  await cappedTransaction(async (tx) => {
    const mcpGrantId = await writeMcpGrant(
      tx,
      {
        clientId: value.clientId,
        userId: input.userId,
        organizationId: input.organizationId,
        scopes: scope,
      },
      now,
    );
    const [updated] = await tx
      .update(schema.verification)
      .set({
        identifier: code,
        value: JSON.stringify({ ...value, scope: granted, requireConsent: false, mcpGrantId }),
        expiresAt: new Date(now.getTime() + CONSENT_CODE_TTL_MS),
      })
      .where(eq(schema.verification.identifier, input.consentCode))
      .returning({ id: schema.verification.id });
    if (updated === undefined) throw invalidRequest();
    await tx.insert(schema.oauthConsent).values({
      id: newId(),
      clientId: value.clientId,
      userId: input.userId,
      scopes: scope,
      consentGiven: true,
    });
  });
  redirect.searchParams.set('code', code);
  if (value.state != null) redirect.searchParams.set('state', value.state);
  return { redirectUri: redirect.toString(), clientId: value.clientId, scope };
}

export interface McpGrantView {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly scopes: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export function listMcpGrants(userId: string): Promise<McpGrantView[]> {
  return db
    .select({
      id: schema.mcpGrant.id,
      clientId: schema.mcpGrant.clientId,
      clientName: schema.oauthApplication.name,
      organizationId: schema.mcpGrant.organizationId,
      organizationName: schema.organization.name,
      scopes: schema.mcpGrant.scopes,
      createdAt: schema.mcpGrant.createdAt,
      lastUsedAt: schema.mcpGrant.lastUsedAt,
    })
    .from(schema.mcpGrant)
    .innerJoin(
      schema.oauthApplication,
      eq(schema.oauthApplication.clientId, schema.mcpGrant.clientId),
    )
    .innerJoin(schema.organization, eq(schema.organization.id, schema.mcpGrant.organizationId))
    .where(and(eq(schema.mcpGrant.userId, userId), isNull(schema.mcpGrant.revokedAt)))
    .orderBy(desc(schema.mcpGrant.createdAt));
}

export async function revokeMcpGrant(
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await cappedTransaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(schema.mcpGrant)
      .where(
        and(
          eq(schema.mcpGrant.id, id),
          eq(schema.mcpGrant.userId, userId),
          isNull(schema.mcpGrant.revokedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (grant === undefined) throw notFound('That connection does not exist.');
    await tx.update(schema.mcpGrant).set({ revokedAt: now }).where(eq(schema.mcpGrant.id, id));
    await tx
      .delete(schema.oauthAccessToken)
      .where(
        and(
          eq(schema.oauthAccessToken.clientId, grant.clientId),
          eq(schema.oauthAccessToken.userId, userId),
        ),
      );
  });
}
