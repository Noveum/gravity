import { createHash } from 'node:crypto';
import { db, schema, sql } from '@gravity/db';
import type { OrgRole } from '@gravity/shared/constants';
import { DomainError } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { bindMcpCredential, recordMcpGrant } from './auth/mcp-token.ts';
import { newId } from './internal.ts';
import { acceptInvite, createInvite } from './org/invite-service.ts';
import { resolvePrincipal } from './org/member-service.ts';
import { createOrganization } from './org/organization-service.ts';

const TEST_DATABASE_NAME = /^gravity_test(?:_[a-z0-9]+)*$/;

export async function resetDatabase(): Promise<void> {
  const [current] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const name = String(current?.['name'] ?? 'unknown');
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(`resetDatabase refuses to truncate "${name}".`);
  }
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const tables = rows.map((row) => `"${row['tablename']}"`).join(', ');
  if (tables.length > 0) {
    await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
  }
  await db.execute(sql`select setval('sync_id_seq', 1, false)`);
}

export async function createUser(name: string): Promise<typeof schema.user.$inferSelect> {
  const id = newId();
  const handle = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${id.slice(-8)}`;
  const [row] = await db
    .insert(schema.user)
    .values({ id, name, email: `${handle}@gravity.test`, handle, emailVerified: true })
    .returning();
  if (row === undefined) throw new Error('Could not create the test user.');
  return row;
}

export interface TestWorkspace {
  readonly organizationId: string;
  readonly admin: Principal;
  readonly adminUser: typeof schema.user.$inferSelect;
}

export async function createWorkspace(name = 'Acme'): Promise<TestWorkspace> {
  const adminUser = await createUser('Ada Admin');
  const created = await createOrganization(adminUser.id, {
    name,
    slug: `${name.toLowerCase()}-${newId().slice(-8)}`,
  });
  const admin = await resolvePrincipal(adminUser.id, created.organization.id);
  return { organizationId: created.organization.id, admin, adminUser };
}

export async function createMemberPrincipal(
  workspace: TestWorkspace,
  role: 'guest' | 'contributor' | 'member',
): Promise<Principal> {
  const user = await createUser(`${role} user`);
  const { token } = await createInvite(workspace.admin, { email: user.email, role });
  await acceptInvite(token, user.id);
  return await resolvePrincipal(user.id, workspace.organizationId);
}

export async function addMember(
  workspace: TestWorkspace,
  name: string,
  role: OrgRole,
): Promise<Principal> {
  const user = await createUser(name);
  const { token } = await createInvite(workspace.admin, { email: user.email, role });
  await acceptInvite(token, user.id);
  return await resolvePrincipal(user.id, workspace.organizationId);
}

export async function configurationFootprint(): Promise<Record<string, number>> {
  const counts = async (table: 'brand' | 'pipeline' | 'stage' | 'field_definition' | 'outbox') => {
    const [row] = await db.execute<{ total: string }>(
      sql.raw(`select count(*)::text as total from "${table}"`),
    );
    return Number(row?.['total'] ?? 0);
  };
  return {
    brand: await counts('brand'),
    pipeline: await counts('pipeline'),
    stage: await counts('stage'),
    field_definition: await counts('field_definition'),
    outbox: await counts('outbox'),
  };
}

export interface TestLeadInput {
  readonly organizationId: string;
  readonly pipelineId: string;
  readonly stageId: string;
  readonly stageCategory?: 'open' | 'hold' | 'won' | 'lost';
  readonly archivedAt?: Date | null;
}

export async function insertTestLead(input: TestLeadInput): Promise<string> {
  const personId = newId();
  await db
    .insert(schema.person)
    .values({ id: personId, organizationId: input.organizationId, name: 'Test Person' });
  const [numbered] = await db.execute<{ next: string }>(
    sql`select (coalesce(max(number), 0) + 1)::text as next from lead where pipeline_id = ${input.pipelineId}`,
  );
  const id = newId();
  await db.insert(schema.lead).values({
    id,
    organizationId: input.organizationId,
    personId,
    pipelineId: input.pipelineId,
    number: Number(numbered?.['next'] ?? 1),
    stageId: input.stageId,
    stageCategory: input.stageCategory ?? 'open',
    archivedAt: input.archivedAt ?? null,
  });
  return id;
}

export async function refusal(attempt: Promise<unknown>): Promise<DomainError> {
  try {
    await attempt;
  } catch (error: unknown) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Expected the call to be refused, but it succeeded.');
}

export const MCP_TEST_SECRET = 'gravity-test-secret-0123456789abcdef';
export const MCP_TEST_CODE_VERIFIER = 'gravity-test-code-verifier-0123456789abcdefghijklmnop';

export function mcpTestSecret(): string {
  const configured = process.env['BETTER_AUTH_SECRET'];
  if (configured !== undefined && configured.length >= 16) return configured;
  process.env['BETTER_AUTH_SECRET'] = MCP_TEST_SECRET;
  return MCP_TEST_SECRET;
}

function compactId(): string {
  return newId().replace(/-/g, '');
}

export interface TestMcpClientOptions {
  readonly clientId?: string;
  readonly name?: string;
  readonly redirectUrl?: string;
  readonly icon?: string;
}

export async function insertMcpClient(
  userId: string,
  options: TestMcpClientOptions = {},
): Promise<string> {
  const clientId = options.clientId ?? `gravity_test_${compactId()}`;
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    name: options.name ?? 'Test agent',
    clientId,
    redirectUrls: options.redirectUrl ?? 'http://127.0.0.1:4321/callback',
    icon: options.icon ?? null,
    type: 'public',
    userId,
  });
  return clientId;
}

export interface TestMcpConsentRequest {
  readonly clientId: string;
  readonly userId: string;
  readonly scope: readonly string[];
  readonly redirectUri: string;
  readonly state?: string;
  readonly codeVerifier?: string;
  readonly expiresAt?: Date;
}

export async function insertMcpConsentRequest(request: TestMcpConsentRequest): Promise<string> {
  const consentCode = compactId();
  const verifier = request.codeVerifier ?? MCP_TEST_CODE_VERIFIER;
  await db.insert(schema.verification).values({
    id: newId(),
    identifier: consentCode,
    value: JSON.stringify({
      clientId: request.clientId,
      redirectURI: request.redirectUri,
      scope: request.scope,
      userId: request.userId,
      requireConsent: true,
      state: request.state ?? 'state-test',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
    }),
    expiresAt: request.expiresAt ?? new Date(Date.now() + 600_000),
  });
  return consentCode;
}

export interface MintedMcpToken {
  readonly token: string;
  readonly clientId: string;
  readonly grantId: string;
  readonly rawAccessToken: string;
}

export async function mintMcpToken(
  organizationId: string,
  userId: string,
  scopes = 'openid gravity.read gravity.write',
): Promise<MintedMcpToken> {
  const secret = mcpTestSecret();
  const clientId = await insertMcpClient(userId);
  const grantId = await recordMcpGrant({ clientId, userId, organizationId, scopes });
  const rawAccessToken = `at_${compactId()}${compactId()}`;
  await db.insert(schema.oauthAccessToken).values({
    id: newId(),
    accessToken: rawAccessToken,
    refreshToken: `rt_${compactId()}${compactId()}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    clientId,
    userId,
    scopes,
  });
  return {
    token: bindMcpCredential(rawAccessToken, grantId, secret),
    clientId,
    grantId,
    rawAccessToken,
  };
}
