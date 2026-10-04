import { and, db, eq, schema } from '@gravity/db';
import type { BrandColor } from '@gravity/shared/constants';
import { conflict } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { createBrand } from '../crm/brand-service.ts';
import { createFieldDefinition, listFieldDefinitions } from '../crm/field-service.ts';
import { listPipelines } from '../crm/pipeline-service.ts';
import type { WriteContext } from '../crm/write-context.ts';
import { commitImport } from '../import/import-service.ts';
import { newId } from '../internal.ts';
import { acceptInvite, createInvite } from '../org/invite-service.ts';
import { findPrincipal, resolvePrincipal } from '../org/member-service.ts';
import { assertEmailDomainAllowed, createOrganization } from '../org/organization-service.ts';

export interface DemoSeedOptions {
  readonly slug: string;
  readonly domain: string;
  readonly reuse?: boolean;
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

async function ensureUser(name: string, email: string, handle: string) {
  const existing = await userByEmail(email);
  if (existing !== undefined) return existing;
  const [created] = await db
    .insert(schema.user)
    .values({ id: newId(), name, email, handle, emailVerified: true })
    .returning();
  if (created === undefined) throw new Error(`Could not create the demo user ${email}.`);
  return created;
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

async function adminOf(organizationId: string, ownerEmail: string, slug: string) {
  const owner = await userByEmail(ownerEmail);
  const principal = owner === undefined ? null : await findPrincipal(owner.id, organizationId);
  if (owner === undefined || principal === null || principal.role !== 'admin') {
    throw conflict(
      `The workspace ${slug} was not created by this seed (${ownerEmail} is not its admin), so it is left alone. Pass --slug to seed another one.`,
    );
  }
  return owner;
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

export async function seedDemoWorkspace(
  options: DemoSeedOptions = DEMO_SEED_DEFAULTS,
): Promise<DemoSeedResult> {
  const ownerEmail = `alex@${options.domain}`;
  const teammateEmail = `sam@${options.domain}`;
  assertEmailDomainAllowed(ownerEmail);
  assertEmailDomainAllowed(teammateEmail);
  const existing = await organizationOf(options.slug);
  if (existing !== undefined && options.reuse !== true) {
    throw conflict(
      `A workspace with the slug ${options.slug} already exists. Pass --slug to seed another one, or --reuse to complete that demo workspace.`,
    );
  }
  const reused = existing !== undefined;
  const teammate = await ensureUser('Sam Okafor', teammateEmail, `${options.slug}-sam`);
  const ownerUser =
    existing === undefined
      ? await ensureUser('Alex Rivera', ownerEmail, `${options.slug}-alex`)
      : await adminOf(existing.id, ownerEmail, options.slug);
  const organizationId =
    existing?.id ??
    (await createOrganization(ownerUser.id, { name: 'Demo Outreach', slug: options.slug }))
      .organization.id;
  const owner = await resolvePrincipal(ownerUser.id, organizationId);
  await ensureTeammate(owner, teammate);
  const context: WriteContext = { principal: owner };
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
    slug: options.slug,
    ownerEmail,
    teammateEmail,
    reused,
    brands: DEMO_BRANDS.length,
    people: await db.$count(schema.person, eq(schema.person.organizationId, organizationId)),
    leads: await db.$count(schema.lead, eq(schema.lead.organizationId, organizationId)),
  };
}
