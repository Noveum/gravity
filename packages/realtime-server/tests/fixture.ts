import { db, eq, schema } from '@gravity/db';
import { randomUUIDv7 } from '@gravity/shared/utils';

export interface SeededWorkspace {
  readonly organizationId: string;
  readonly adminUserId: string;
  readonly readerUserId: string;
  readonly strangerUserId: string;
}

const created: string[] = [];

function id(prefix: string): string {
  return `${prefix}_${randomUUIDv7()}`;
}

async function insertUser(name: string): Promise<string> {
  const userId = id('usr');
  const handle = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}${userId.slice(-8)}`;
  await db.insert(schema.user).values({
    id: userId,
    name,
    email: `${handle}@gravity.test`,
    handle,
    emailVerified: true,
  });
  return userId;
}

export async function seedWorkspace(name: string): Promise<SeededWorkspace> {
  const organizationId = id('org');
  created.push(organizationId);
  await db.insert(schema.organization).values({
    id: organizationId,
    name,
    slug: organizationId.toLowerCase(),
  });

  const adminUserId = await insertUser('Ada Admin');
  const readerUserId = await insertUser('Rin Reader');
  const strangerUserId = await insertUser('Sam Stranger');

  await db.insert(schema.member).values([
    { id: id('mem'), organizationId, userId: adminUserId, role: 'admin' },
    { id: id('mem'), organizationId, userId: readerUserId, role: 'member' },
    { id: id('mem'), organizationId, userId: strangerUserId, role: 'member' },
  ]);

  return { organizationId, adminUserId, readerUserId, strangerUserId };
}

export async function dropSeededWorkspaces(): Promise<void> {
  for (const organizationId of created.splice(0)) {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  }
}

export async function insertSession(
  userId: string,
  expiresAt: Date,
): Promise<{ sessionId: string; token: string }> {
  const sessionId = id('ses');
  const token = id('tok');
  await db.insert(schema.session).values({ id: sessionId, userId, token, expiresAt });
  return { sessionId, token };
}
