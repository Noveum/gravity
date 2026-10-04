import { and, db, eq, inArray, isNotNull, isNull, schema } from '@gravity/db';
import type { BrandColor } from '@gravity/shared/constants';
import { conflict, validationFailed } from '@gravity/shared/errors';
import type { SyncAction } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import { organizationCreateSchema } from '@gravity/shared/validators';
import { z } from 'zod';
import { createBrand } from '../crm/brand-service.ts';
import { createFieldDefinition, listFieldDefinitions } from '../crm/field-service.ts';
import { listPipelines } from '../crm/pipeline-service.ts';
import type { WriteContext } from '../crm/write-context.ts';
import { commitImport } from '../import/import-service.ts';
import { newId } from '../internal.ts';
import { acceptInvite, createInvite } from '../org/invite-service.ts';
import { findPrincipal, resolvePrincipal } from '../org/member-service.ts';
import {
  assertEmailDomainAllowed,
  createOrganization,
  type OrganizationRow,
} from '../org/organization-service.ts';
import { flushOutbox } from '../realtime/outbox.ts';
import { assertSeedDomain } from './seed-guard.ts';

export interface DemoSeedOptions {
  readonly slug: string;
  readonly domain: string;
  readonly reuse?: boolean;
  readonly allowRealDomain?: boolean;
}

export const DEMO_SEED_DEFAULTS = { slug: 'demo', domain: 'gravity.test' } as const;

export interface DemoBrand {
  readonly name: string;
  readonly key: string;
  readonly domain: string;
  readonly color: BrandColor;
  readonly rows: readonly string[];
}

export interface DemoSeedResult {
  readonly organizationId: string;
  readonly slug: string;
  readonly ownerEmail: string;
  readonly teammateEmail: string;
  readonly reused: boolean;
  readonly brands: number;
  readonly people: number;
  readonly leads: number;
}

export const DEMO_SEED_MARKER = 'gravity-demo-seed';
const DEMO_WORKSPACE_NAME = 'Demo Outreach';
const demoMarkerSchema = z.object({ createdBy: z.literal(DEMO_SEED_MARKER) });
const IMPORT_SOURCE = 'demo-seed';
const OWNER_TOKEN = '{owner}';
const TEAMMATE_TOKEN = '{teammate}';
const HEADER = 'Name,Email,Phone,Title,Company,Domain,Stage,Owner,Priority,Seniority,Source id';

const SEED_MAPPING = {
  Name: 'person.name',
  Email: 'person.email',
  Phone: 'person.phone',
  Title: 'person.title',
  Company: 'company.name',
  Domain: 'company.domain',
  Stage: 'lead.stage',
  Owner: 'lead.owner',
  Priority: 'lead.priority',
  Seniority: 'person.field.seniority',
  'Source id': 'sourceId',
} as const;

export const DEMO_BRANDS: readonly DemoBrand[] = [
  {
    name: 'Lumbrook Analytics',
    key: 'LUM',
    domain: 'lumbrook.example',
    color: 'blue',
    rows: [
      'Amara Okafor,amara@vela.example,+1 555 0101,VP Engineering,Vela Robotics,vela.example,New,{owner},High,executive',
      'Liam Chen,liam@quarry.example,+1 555 0102,Head of Data,Quarry Labs,quarry.example,Researching,{owner},Medium,senior',
      'Sofia Marquez,sofia@kestrel.example,+1 555 0103,CTO,Kestrel Analytics,kestrel.example,Contacted,{teammate},Urgent,executive',
      'Ravi Patel,ravi@bluefin.example,+1 555 0104,Data Engineer,Bluefin Health,bluefin.example,Follow-up,{teammate},Low,junior',
      'Hana Kim,hana@brindlemoor.example,+1 555 0105,Analytics Lead,Brindlemoor Savings,brindlemoor.example,Replied,{owner},High,senior',
      'Jonas Weber,jonas@ember.example,+1 555 0106,Engineering Manager,Ember Games,ember.example,Meeting booked,{owner},Medium,senior',
    ],
  },
  {
    name: 'Harbor Studio',
    key: 'HAR',
    domain: 'harbor.example',
    color: 'green',
    rows: [
      'Priya Nair,priya@wrenfield.example,+1 555 0107,COO,Wrenfield Power,wrenfield.example,Ready,{teammate},High,executive',
      'Mateo Rossi,mateo@larkspur.example,+1 555 0108,Head of Product,Larkspur Foods,larkspur.example,Contacted,{owner},Medium,senior',
      'Ingrid Larsen,ingrid@slatewick.example,+1 555 0109,Founder,Slatewick Security,slatewick.example,Meeting held,{teammate},Urgent,executive',
      'Tomas Novak,tomas@meridian.example,+1 555 0110,Product Designer,Meridian Travel,meridian.example,Qualified,{owner},Low,junior',
      'Amara Okafor,amara@vela.example,+1 555 0101,VP Engineering,Vela Robotics,vela.example,Researching,{teammate},Medium,executive',
    ],
  },
  {
    name: 'Atlas Market',
    key: 'ATL',
    domain: 'atlasmarket.example',
    color: 'amber',
    rows: [
      'Aisha Bello,aisha@orchard.example,+1 555 0111,Owner,Orchard Learning,orchard.example,New,{owner},Medium,senior',
      'Kenji Watanabe,kenji@northwind.example,+1 555 0112,Operations Lead,Northwind Freight,northwind.example,Contacted,{teammate},Low,senior',
      'Elena Petrova,elena@saltmarsh.example,+1 555 0113,Founder,Saltmarsh Ceramics,saltmarsh.example,Closed: no reply,{owner},Low,executive',
      'Noah Fischer,noah@brightloom.example,+1 555 0114,Shop Manager,Brightloom Textiles,brightloom.example,Replied,{teammate},High,junior',
      'Hana Kim,hana@brindlemoor.example,+1 555 0105,Analytics Lead,Brindlemoor Savings,brindlemoor.example,New,{teammate},Low,senior',
    ],
  },
  {
    name: 'Seed Round',
    key: 'SED',
    domain: 'seedround.example',
    color: 'violet',
    rows: [
      'Zara Ahmed,zara@halyard.example,+1 555 0115,Partner,Halyard Ventures,halyard.example,Ready,{owner},Urgent,executive',
      'Lucas Moreau,lucas@pinecrest.example,+1 555 0116,Principal,Pinecrest Partners,pinecrest.example,Contacted,{owner},High,senior',
      'Maya Cohen,maya@granite.example,+1 555 0117,Angel,Granite Angels,granite.example,Meeting booked,{owner},Medium,executive',
      'Diego Alvarez,diego@larchwood.example,+1 555 0118,Associate,Larchwood Capital,larchwood.example,Closed: not a fit,{owner},Low,junior',
    ],
  },
];

const SENIORITY_OPTIONS = [
  { value: 'junior', label: 'Junior' },
  { value: 'senior', label: 'Senior' },
  { value: 'executive', label: 'Executive' },
];

async function userByEmail(email: string) {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  return row;
}

async function assertHandleIsFree(handle: string, email: string): Promise<void> {
  const [holder] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.handle, handle))
    .limit(1);
  if (holder !== undefined && holder.email !== email) {
    throw conflict(
      `The handle ${handle} belongs to another account. Seed with another --slug or --domain.`,
    );
  }
}

async function createMissingUser(name: string, email: string, handle: string) {
  const existing = await userByEmail(email);
  if (existing !== undefined) return { user: existing, created: false };
  const [created] = await db
    .insert(schema.user)
    .values({ id: newId(), name, email, handle, emailVerified: true })
    .returning();
  if (created === undefined) throw new Error(`Could not create the demo user ${email}.`);
  return { user: created, created: true };
}

function sourceIdOf(row: string): string {
  const email = row.split(',')[1] ?? '';
  return `demo-${email.split('@')[0] ?? email}`;
}

function csvOf(brand: DemoBrand, ownerEmail: string, teammateEmail: string): string {
  const rows = brand.rows.map((row) => {
    const filled = row
      .replaceAll(OWNER_TOKEN, ownerEmail)
      .replaceAll(TEAMMATE_TOKEN, teammateEmail);
    return `${filled},${sourceIdOf(row)}`;
  });
  return [HEADER, ...rows].join('\n');
}

async function assertReusable(organization: OrganizationRow, ownerEmail: string) {
  const notOurs = conflict(
    `The workspace ${organization.slug} was not created by this seed, so it is left alone. Pass --slug to seed another one.`,
  );
  if (!isMarked(organization.metadata)) throw notOurs;
  const owner = await userByEmail(ownerEmail);
  const principal = owner === undefined ? null : await findPrincipal(owner.id, organization.id);
  if (owner === undefined || principal === null || principal.role !== 'admin') throw notOurs;
  const keys = DEMO_BRANDS.map((brand) => brand.key);
  const [archivedPipeline] = await db
    .select({ key: schema.pipeline.key })
    .from(schema.pipeline)
    .where(
      and(
        eq(schema.pipeline.organizationId, organization.id),
        inArray(schema.pipeline.key, keys),
        isNotNull(schema.pipeline.archivedAt),
      ),
    )
    .limit(1);
  if (archivedPipeline !== undefined) {
    throw conflict(
      `The ${archivedPipeline.key} pipeline in ${organization.slug} was archived and pipeline keys are never reused, so the seed cannot complete it. Seed another workspace with --slug.`,
    );
  }
  const [archivedField] = await db
    .select({ id: schema.fieldDefinition.id })
    .from(schema.fieldDefinition)
    .where(
      and(
        eq(schema.fieldDefinition.organizationId, organization.id),
        eq(schema.fieldDefinition.object, 'person'),
        eq(schema.fieldDefinition.key, 'seniority'),
        isNotNull(schema.fieldDefinition.archivedAt),
      ),
    )
    .limit(1);
  if (archivedField !== undefined) {
    throw conflict(
      `The seniority field in ${organization.slug} was archived, so the seed cannot complete it. Seed another workspace with --slug.`,
    );
  }
  return owner;
}

function isMarked(metadata: string | null): boolean {
  if (metadata === null) return false;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return demoMarkerSchema.safeParse(parsed).success;
  } catch {
    return false;
  }
}

async function ensureTeammate(
  owner: Principal,
  teammate: { id: string; email: string },
): Promise<void> {
  const [member] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, owner.organizationId),
        eq(schema.member.userId, teammate.id),
      ),
    )
    .limit(1);
  if (member !== undefined) return;
  const invite = await createInvite(owner, { email: teammate.email, role: 'member' });
  await acceptInvite(invite.token, teammate.id);
}

async function ensureSeniorityField(context: WriteContext): Promise<void> {
  const fields = await listFieldDefinitions(context.principal);
  if (fields.some((field) => field.object === 'person' && field.key === 'seniority')) return;
  await createFieldDefinition(context, {
    object: 'person',
    key: 'seniority',
    label: 'Seniority',
    type: 'select',
    options: SENIORITY_OPTIONS,
  });
}

async function ensurePipeline(context: WriteContext, brand: DemoBrand): Promise<string> {
  const pipelines = await listPipelines(context.principal);
  const existing = pipelines.find((pipeline) => pipeline.key === brand.key);
  if (existing !== undefined) return existing.id;
  const made = await createBrand(context, {
    name: brand.name,
    domain: brand.domain,
    color: brand.color,
    pipelineKey: brand.key,
  });
  return made.pipeline.id;
}

async function importBrand(
  context: WriteContext,
  brand: DemoBrand,
  pipelineId: string,
  emails: { owner: string; teammate: string },
  actorName: string,
): Promise<void> {
  const report = await commitImport(
    context,
    {
      format: 'csv',
      content: csvOf(brand, emails.owner, emails.teammate),
      target: 'leads',
      pipelineId,
      mapping: SEED_MAPPING,
      source: IMPORT_SOURCE,
      defaultOwner: 'me',
    },
    { actorName },
  );
  const problems = report.rows.flatMap((row) =>
    row.issues.map((issue) => `row ${row.row}: ${issue.message}`),
  );
  if (report.status !== 'completed' || problems.length > 0) {
    const reason = report.failure?.message ?? problems.join('; ');
    throw new Error(`The ${brand.name} seed did not import cleanly: ${reason}`);
  }
}

async function organizationOf(slug: string) {
  const [row] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return row;
}

async function createDemoOrganization(
  slug: string,
  owner: { name: string; email: string; handle: string },
  teammate: { name: string; email: string; handle: string },
) {
  const made: string[] = [];
  try {
    const ownerUser = await createMissingUser(owner.name, owner.email, owner.handle);
    if (ownerUser.created) made.push(ownerUser.user.id);
    const teammateUser = await createMissingUser(teammate.name, teammate.email, teammate.handle);
    if (teammateUser.created) made.push(teammateUser.user.id);
    const created = await createOrganization(
      ownerUser.user.id,
      { name: DEMO_WORKSPACE_NAME, slug },
      { metadata: JSON.stringify({ createdBy: DEMO_SEED_MARKER }) },
    );
    return { organizationId: created.organization.id, ownerUser: ownerUser.user };
  } catch (error: unknown) {
    if (made.length > 0) await db.delete(schema.user).where(inArray(schema.user.id, made));
    throw error;
  }
}

function validSlug(slug: string): string {
  const parsed = organizationCreateSchema.safeParse({ name: DEMO_WORKSPACE_NAME, slug });
  if (!parsed.success) {
    throw validationFailed(
      parsed.error.issues[0]?.message ?? 'That workspace address is not valid.',
    );
  }
  return parsed.data.slug;
}

export async function publishSeededOutbox(
  organizationId: string,
  publish?: (actions: SyncAction[]) => Promise<boolean>,
): Promise<number> {
  const pending = await db
    .select({ syncId: schema.outbox.syncId })
    .from(schema.outbox)
    .where(
      and(eq(schema.outbox.organizationId, organizationId), isNull(schema.outbox.publishedAt)),
    );
  return await flushOutbox(
    pending.map((row) => row.syncId),
    publish,
  );
}

export async function seedDemoWorkspace(
  options: DemoSeedOptions = DEMO_SEED_DEFAULTS,
): Promise<DemoSeedResult> {
  const slug = validSlug(options.slug);
  const domain = assertSeedDomain(options.domain, options.allowRealDomain === true);
  const ownerEmail = `alex@${domain}`;
  const teammateEmail = `sam@${domain}`;
  assertEmailDomainAllowed(ownerEmail);
  assertEmailDomainAllowed(teammateEmail);
  const owner = { name: 'Alex Rivera', email: ownerEmail, handle: `${slug}-alex` };
  const teammate = { name: 'Sam Okafor', email: teammateEmail, handle: `${slug}-sam` };
  await assertHandleIsFree(owner.handle, owner.email);
  await assertHandleIsFree(teammate.handle, teammate.email);
  const existing = await organizationOf(slug);
  if (existing !== undefined && options.reuse !== true) {
    throw conflict(
      `A workspace with the slug ${slug} already exists. Pass --slug to seed another one, or --reuse to complete a demo workspace this seed made.`,
    );
  }
  const reused = existing !== undefined;
  const { organizationId, ownerUser } =
    existing === undefined
      ? await createDemoOrganization(slug, owner, teammate)
      : { organizationId: existing.id, ownerUser: await assertReusable(existing, ownerEmail) };
  const teammateUser = (await createMissingUser(teammate.name, teammate.email, teammate.handle))
    .user;
  const principal = await resolvePrincipal(ownerUser.id, organizationId);
  await ensureTeammate(principal, teammateUser);
  const context: WriteContext = { principal };
  await ensureSeniorityField(context);
  for (const brand of DEMO_BRANDS) {
    const pipelineId = await ensurePipeline(context, brand);
    await importBrand(
      context,
      brand,
      pipelineId,
      { owner: ownerEmail, teammate: teammateEmail },
      ownerUser.name,
    );
  }
  return {
    organizationId,
    slug,
    ownerEmail,
    teammateEmail,
    reused,
    brands: DEMO_BRANDS.length,
    people: await db.$count(schema.person, eq(schema.person.organizationId, organizationId)),
    leads: await db.$count(schema.lead, eq(schema.lead.organizationId, organizationId)),
  };
}
