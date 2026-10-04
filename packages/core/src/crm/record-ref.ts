import { and, asc, db, eq, isNull, type SQL, schema } from '@gravity/db';
import { notFound, validationFailed } from '@gravity/shared/errors';
import { assertCan, type Principal } from '@gravity/shared/policy';
import {
  linkedWorkspace,
  normalizeDomain,
  parseIdentityInput,
  parseLeadKey,
  RECORD_LINK_PATHS,
  type RecordLinks,
} from '@gravity/shared/utils';
import { arrayOverlaps } from 'drizzle-orm';
import { getLeadByKey } from './lead-service.ts';

export type RecordRefType = 'person' | 'company' | 'lead';

export interface ResolvedRecordRef {
  readonly type: RecordRefType;
  readonly id: string;
}

const SHOWN_REF_LENGTH = 80;
const LINKEDIN_HOST = /(?:^|\.)linkedin\.com$/;
const HOST_WITH_PATH = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]+[/?#]./i;

function isLinkedinPage(ref: string, domain: string): boolean {
  return LINKEDIN_HOST.test(domain) && HOST_WITH_PATH.test(ref);
}

function nothingMatches(ref: string) {
  return notFound(
    `Nothing in this workspace matches "${ref.slice(0, SHOWN_REF_LENGTH)}". Use an email, a LinkedIn profile URL, a domain, a lead key like ABC-12, or an id.`,
  );
}

async function personWhere(organizationId: string, condition: SQL): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(
      and(
        eq(schema.person.organizationId, organizationId),
        isNull(schema.person.archivedAt),
        condition,
      ),
    )
    .orderBy(asc(schema.person.createdAt), asc(schema.person.id))
    .limit(1);
  return row?.id ?? null;
}

async function companyWhere(organizationId: string, condition: SQL): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(
      and(
        eq(schema.company.organizationId, organizationId),
        isNull(schema.company.archivedAt),
        condition,
      ),
    )
    .orderBy(asc(schema.company.createdAt), asc(schema.company.id))
    .limit(1);
  return row?.id ?? null;
}

async function leadWhere(organizationId: string, leadId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .innerJoin(schema.pipeline, eq(schema.pipeline.id, schema.lead.pipelineId))
    .innerJoin(schema.person, eq(schema.person.id, schema.lead.personId))
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.id, leadId),
        isNull(schema.lead.archivedAt),
        isNull(schema.pipeline.archivedAt),
        isNull(schema.person.archivedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function recordById(organizationId: string, id: string): Promise<ResolvedRecordRef | null> {
  const person = await personWhere(organizationId, eq(schema.person.id, id));
  if (person !== null) return { type: 'person', id: person };
  const company = await companyWhere(organizationId, eq(schema.company.id, id));
  if (company !== null) return { type: 'company', id: company };
  const lead = await leadWhere(organizationId, id);
  return lead === null ? null : { type: 'lead', id: lead };
}

function found(type: RecordRefType, id: string | null, ref: string): ResolvedRecordRef {
  if (id === null) throw nothingMatches(ref);
  return { type, id };
}

export interface ResolveRecordRefOptions {
  readonly links?: RecordLinks;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

type AppLinkTarget = { type: RecordRefType; rest: string } | 'elsewhere';

function appLinkTarget(ref: string, links: RecordLinks): AppLinkTarget | null {
  const bare = (value: string) => value.replace(SCHEME, '').toLowerCase();
  const base = bare(links.base);
  const candidates: [RecordRefType, string][] = [
    ['person', `${base}${RECORD_LINK_PATHS.person}`],
    ['company', `${base}${RECORD_LINK_PATHS.company}`],
    ['lead', `${base}${RECORD_LINK_PATHS.lead}`],
  ];
  const lowered = bare(ref);
  for (const [type, prefix] of candidates) {
    if (!lowered.startsWith(prefix)) continue;
    const named = linkedWorkspace(ref);
    if (named !== null && named !== links.workspace.toLowerCase()) return 'elsewhere';
    const tail = ref.replace(SCHEME, '').slice(prefix.length);
    const rest = (tail.split(/[/?#]/)[0] ?? '').trim();
    if (rest.length === 0) return null;
    try {
      return { type, rest: decodeURIComponent(rest) };
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveLeadKey(
  principal: Principal,
  key: string,
  ref: string,
): Promise<ResolvedRecordRef> {
  const lead = await getLeadByKey(principal, key);
  return found('lead', await leadWhere(principal.organizationId, lead.id), ref);
}

export async function resolveRecordRef(
  principal: Principal,
  raw: string,
  options: ResolveRecordRefOptions = {},
): Promise<ResolvedRecordRef> {
  assertCan(principal, 'record:read');
  const ref = raw.trim();
  if (ref.length === 0) {
    throw validationFailed('Name a record by email, LinkedIn URL, domain, lead key or id.');
  }
  const organizationId = principal.organizationId;
  if (parseLeadKey(ref) !== null) return await resolveLeadKey(principal, ref, ref);
  const app = options.links === undefined ? null : appLinkTarget(ref, options.links);
  if (app === 'elsewhere') throw nothingMatches(ref);
  if (app !== null) {
    if (app.type === 'lead') return await resolveLeadKey(principal, app.rest, ref);
    return found(
      app.type,
      app.type === 'person'
        ? await personWhere(organizationId, eq(schema.person.id, app.rest))
        : await companyWhere(organizationId, eq(schema.company.id, app.rest)),
      ref,
    );
  }
  const identity = parseIdentityInput(ref);
  if (identity?.kind === 'linkedin') {
    return found(
      'person',
      await personWhere(organizationId, eq(schema.person.linkedinUrl, identity.linkedinUrl)),
      ref,
    );
  }
  if (identity?.kind === 'email') {
    return found(
      'person',
      await personWhere(organizationId, arrayOverlaps(schema.person.emails, [identity.email])),
      ref,
    );
  }
  const domain = ref.includes('.') && !/\s/.test(ref) ? normalizeDomain(ref) : null;
  if (domain !== null) {
    if (isLinkedinPage(ref, domain)) throw nothingMatches(ref);
    return found(
      'company',
      await companyWhere(organizationId, arrayOverlaps(schema.company.domains, [domain])),
      ref,
    );
  }
  const byId = await recordById(organizationId, ref);
  if (byId === null) throw nothingMatches(ref);
  return byId;
}
