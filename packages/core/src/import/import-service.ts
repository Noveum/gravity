import { and, db, eq, isNull, ne, type SQL, schema } from '@gravity/db';
import { internal, toDomainError, validationFailed } from '@gravity/shared/errors';
import type { Actor, SyncAction } from '@gravity/shared/events';
import {
  HTTP_IMPORT_LIMITS,
  IMPORT_CHUNK_MS,
  IMPORT_CHUNK_ROWS,
  IMPORT_PREVIEW_CHUNK_ROWS,
  type ImportIssueCode,
  type ImportLimits,
  type ImportReport,
  type ImportRequest,
  type ImportRowOutcome,
  type ImportSetup,
  importRequestSchema,
  mappingIssues,
  type PlannedRow,
  parseImportTable,
  planImport,
  totalsOf,
} from '@gravity/shared/import';
import { assertCan, type Principal } from '@gravity/shared/policy';
import type { CompanyRow, LeadRow } from '@gravity/shared/records';
import {
  type CompanyInput,
  type FieldValue,
  fieldsMetaSchema,
  mergeFields,
  type PersonInput,
} from '@gravity/shared/validators';
import { arrayOverlaps } from 'drizzle-orm';
import { diffValues } from '../crm/activity-service.ts';
import {
  COMPANY_DIFF_KEYS,
  findCompanyMatch,
  mergedCompanyValues,
  type StoredCompany,
  writeCompanyIn,
} from '../crm/company-service.ts';
import { asConflict } from '../crm/conflicts.ts';
import { loadFieldDefinitions } from '../crm/field-service.ts';
import { selectLeadRows } from '../crm/lead-rows.ts';
import { createLeadsIn, type LeadDraft } from '../crm/lead-service.ts';
import { livePipeline, liveStagesOf } from '../crm/lookups.ts';
import { personRowById } from '../crm/person-lookup.ts';
import {
  findPersonMatch,
  type KnownPerson,
  mergedPersonValues,
  PERSON_DIFF_KEYS,
  type StoredPerson,
  writePersonIn,
} from '../crm/person-service.ts';
import { companyRowOf } from '../crm/rows.ts';
import {
  cappedTransaction,
  retryOnUniqueViolation,
  type SyncBatch,
  withBatch,
} from '../crm/sync-batch.ts';
import type { WriteContext } from '../crm/write-context.ts';
import type { Executor } from '../internal.ts';
import { listMembers } from '../org/member-service.ts';
import { linkImportSource, sourceLinkedPersonId } from './import-source.ts';

export const IMPORT_ACTOR_PREFIX = 'import:';

export function importActor(principal: Principal, userName: string): Actor {
  return {
    type: 'integration',
    id: `${IMPORT_ACTOR_PREFIX}${principal.userId}`,
    name: `Import by ${userName}`,
  };
}

export interface ImportPreviewOptions {
  readonly limits?: ImportLimits;
  readonly chunkRows?: number;
  readonly deadline?: number;
  readonly now?: () => number;
}

export interface ImportRunOptions extends ImportPreviewOptions {
  readonly actorName: string;
  readonly publish?: (actions: readonly SyncAction[]) => Promise<void>;
}

interface ImportContext {
  readonly organizationId: string;
  readonly setup: ImportSetup;
  readonly source: string;
  readonly actor: Actor;
  readonly now: Date;
  readonly lock: boolean;
}

interface PreparedImport {
  readonly request: ImportRequest;
  readonly rows: readonly PlannedRow[];
  readonly remaining: readonly PlannedRow[];
}

interface Simulation {
  readonly companies: Set<string>;
  readonly people: Map<string, number>;
}

interface Assessment {
  readonly outcome: ImportRowOutcome;
  readonly person: PersonInput | null;
  readonly company: CompanyInput | null;
  readonly preferredId: string | null;
  readonly createLead: boolean;
  readonly match: KnownPerson | null;
  readonly companyMatch: StoredCompany | undefined;
  readonly writes: boolean;
}

interface CompanyAssessment {
  readonly outcome: 'create' | 'match';
  readonly existing: StoredCompany | undefined;
  readonly changes: string[];
  readonly kept: string[];
}

const NOTHING = {
  person: null,
  company: null,
  preferredId: null,
  createLead: false,
  match: null,
  companyMatch: undefined,
  writes: false,
} as const;

const FILL_ONLY_KEYS = [
  'name',
  'linkedinUrl',
  'linkedinProviderId',
  'location',
  'timezone',
] as const;

function emptySimulation(): Simulation {
  return { companies: new Set(), people: new Map() };
}

function forkSimulation(simulation: Simulation): Simulation {
  return { companies: new Set(simulation.companies), people: new Map(simulation.people) };
}

function isWritten(outcome: ImportRowOutcome): boolean {
  return outcome.status !== 'invalid' && outcome.status !== 'skipped';
}

function isFieldValue(value: unknown): value is FieldValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function fieldValuesOf(fields: Readonly<Record<string, unknown>>): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isFieldValue(value)) values[key] = value;
  }
  return values;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedKeys<T extends object>(
  before: T,
  after: T,
  keys: readonly (keyof T & string)[],
  beforeFields: Readonly<Record<string, unknown>>,
  afterFields: Readonly<Record<string, unknown>>,
): string[] {
  const changed = Object.keys(diffValues(before, after, keys)).filter((key) => key !== 'fields');
  const fieldKeys = new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)]);
  const fields = [...fieldKeys]
    .filter((key) => !sameValue(beforeFields[key], afterFields[key]))
    .map((key) => `fields.${key}`);
  return [...changed, ...fields];
}

function keptKeys(
  current: Readonly<Record<string, unknown>>,
  suggestions: Readonly<Record<string, FieldValue>>,
): string[] {
  return Object.entries(suggestions)
    .filter(([key, value]) => !sameValue(current[key], value))
    .map(([key]) => `fields.${key}`);
}

function outcomeOf(
  row: PlannedRow,
  status: ImportRowOutcome['status'],
  extra: Partial<ImportRowOutcome> = {},
): ImportRowOutcome {
  return {
    row: row.row,
    status,
    label: row.label,
    matchedBy: null,
    recordId: null,
    changes: [],
    kept: [],
    company: 'none',
    lead: 'none',
    leadKey: null,
    issues: [...row.issues],
    ...extra,
  };
}

function skippedOutcome(
  row: PlannedRow,
  code: ImportIssueCode,
  message: string,
  extra: Partial<ImportRowOutcome> = {},
): Assessment {
  return {
    ...NOTHING,
    outcome: outcomeOf(row, 'skipped', {
      ...extra,
      issues: [{ row: row.row, column: null, code, message }],
    }),
  };
}

function companyLookupKeys(input: CompanyInput): string[] {
  return input.domains.length > 0
    ? input.domains.map((domain) => `domain:${domain}`)
    : [`name:${input.name.toLowerCase()}`];
}

function rememberCompany(simulation: Simulation, input: CompanyInput): void {
  for (const domain of input.domains) simulation.companies.add(`domain:${domain}`);
  simulation.companies.add(`name:${input.name.toLowerCase()}`);
}

function remember(simulation: Simulation, assessed: Assessment, personId: string | null): void {
  if (!isWritten(assessed.outcome)) return;
  if (assessed.company !== null && assessed.outcome.company === 'create') {
    rememberCompany(simulation, assessed.company);
  }
  if (personId !== null && !simulation.people.has(personId)) {
    simulation.people.set(personId, assessed.outcome.row);
  }
}

async function assessCompany(
  executor: Executor,
  context: ImportContext,
  input: CompanyInput,
  simulation: Simulation,
): Promise<CompanyAssessment> {
  const existing = await findCompanyMatch(executor, context.organizationId, input, context.lock);
  if (existing !== undefined) {
    const merged = mergeFields(
      existing.fields,
      fieldsMetaSchema.parse(existing.fieldsMeta),
      fieldValuesOf(input.fields),
      context.actor,
      context.now,
    );
    const next = mergedCompanyValues(existing, input, merged.fields);
    return {
      outcome: 'match',
      existing,
      changes: changedKeys(
        companyRowOf(existing),
        next,
        COMPANY_DIFF_KEYS,
        existing.fields,
        merged.fields,
      ),
      kept: keptKeys(existing.fields, merged.suggestions),
    };
  }
  const planned =
    !context.lock && companyLookupKeys(input).some((key) => simulation.companies.has(key));
  return { outcome: planned ? 'match' : 'create', existing: undefined, changes: [], kept: [] };
}

async function assessCompanyRow(
  executor: Executor,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<Assessment> {
  const input = row.company;
  if (input === null) return { ...NOTHING, outcome: outcomeOf(row, 'invalid') };
  const company = await assessCompany(executor, context, input, simulation);
  const matchedBy = input.domains.length > 0 ? 'domain' : 'name';
  if (company.outcome === 'create') {
    return {
      ...NOTHING,
      company: input,
      writes: true,
      outcome: outcomeOf(row, 'create', { company: 'create' }),
    };
  }
  return {
    ...NOTHING,
    company: input,
    companyMatch: company.existing,
    writes: company.changes.length > 0,
    outcome: outcomeOf(row, company.changes.length > 0 ? 'merge' : 'unchanged', {
      matchedBy,
      recordId: company.existing?.id ?? null,
      changes: company.changes,
      kept: company.kept,
      company: 'match',
    }),
  };
}

async function liveHolder(
  executor: Executor,
  organizationId: string,
  exceptId: string,
  condition: SQL,
): Promise<string | null> {
  const [row] = await executor
    .select({ name: schema.person.name })
    .from(schema.person)
    .where(
      and(
        eq(schema.person.organizationId, organizationId),
        isNull(schema.person.archivedAt),
        ne(schema.person.id, exceptId),
        condition,
      ),
    )
    .limit(1);
  return row?.name ?? null;
}

async function claimConflict(
  executor: Executor,
  organizationId: string,
  existing: StoredPerson,
  input: PersonInput,
): Promise<string | null> {
  const email = existing.primaryEmail === null ? (input.emails[0] ?? null) : null;
  if (email !== null) {
    const holder = await liveHolder(
      executor,
      organizationId,
      existing.id,
      arrayOverlaps(schema.person.emails, [email]),
    );
    if (holder !== null) {
      return `${holder} already uses ${email}, so this row was not merged into ${existing.name}.`;
    }
  }
  const providerId = existing.linkedinProviderId === null ? input.linkedinProviderId : null;
  if (providerId !== null) {
    const holder = await liveHolder(
      executor,
      organizationId,
      existing.id,
      eq(schema.person.linkedinProviderId, providerId),
    );
    if (holder !== null) {
      return `${holder} already has the LinkedIn account ${providerId}, so this row was not merged into ${existing.name}.`;
    }
  }
  return null;
}

async function existingLeadFor(
  executor: Executor,
  organizationId: string,
  personId: string,
  pipelineId: string,
): Promise<LeadRow | undefined> {
  const [lead] = await selectLeadRows(
    executor,
    organizationId,
    and(
      eq(schema.lead.personId, personId),
      eq(schema.lead.pipelineId, pipelineId),
      isNull(schema.lead.archivedAt),
    ),
    { limit: 1 },
  );
  return lead;
}

interface Delta {
  readonly changes: string[];
  readonly kept: string[];
}

interface EmployerAssessment extends Delta {
  readonly person: PersonInput;
  readonly company: CompanyInput | null;
  readonly companyMatch: StoredCompany | undefined;
  readonly companyChanged: boolean;
  readonly outcome: ImportRowOutcome['company'];
}

interface LeadAssessment {
  readonly lead: ImportRowOutcome['lead'];
  readonly leadKey: string | null;
}

async function refusalOf(
  executor: Executor,
  context: ImportContext,
  row: PlannedRow,
  planned: PersonInput,
  match: KnownPerson,
  simulation: Simulation,
): Promise<Assessment | null> {
  const matched = { matchedBy: match.matchedBy, recordId: match.row.id };
  const earlier = simulation.people.get(match.row.id);
  if (earlier !== undefined) {
    return skippedOutcome(row, 'same_record', `Same record as row ${earlier}.`, matched);
  }
  const disagreement =
    match.matchedBy === 'source_id' && row.sourceId !== null
      ? sourceDisagreement(row.sourceId, match.row, planned)
      : null;
  const conflict =
    disagreement ?? (await claimConflict(executor, context.organizationId, match.row, planned));
  return conflict === null ? null : skippedOutcome(row, 'conflict', conflict, matched);
}

function sourceDisagreement(
  sourceId: string,
  linked: StoredPerson,
  planned: PersonInput,
): string | null {
  const incoming = planned.emails[0];
  const known = linked.emails.map((email) => email.toLowerCase());
  if (
    incoming !== undefined &&
    linked.primaryEmail !== null &&
    !known.includes(incoming.toLowerCase())
  ) {
    return `Source id ${sourceId} belongs to ${linked.name}, whose email is ${linked.primaryEmail}, not ${incoming}, so this row was not merged.`;
  }
  const provider = planned.linkedinProviderId;
  if (
    provider !== null &&
    linked.linkedinProviderId !== null &&
    provider !== linked.linkedinProviderId
  ) {
    return `Source id ${sourceId} belongs to ${linked.name}, whose LinkedIn account is ${linked.linkedinProviderId}, not ${provider}, so this row was not merged.`;
  }
  return null;
}

function declinedKeys(existing: StoredPerson, planned: PersonInput): string[] {
  return FILL_ONLY_KEYS.filter((key) => {
    const incoming = planned[key];
    const current = existing[key];
    return incoming !== null && current !== null && incoming !== current;
  });
}

function personDelta(context: ImportContext, existing: StoredPerson, planned: PersonInput): Delta {
  const merged = mergeFields(
    existing.fields,
    fieldsMetaSchema.parse(existing.fieldsMeta),
    fieldValuesOf(planned.fields),
    context.actor,
    context.now,
  );
  return {
    changes: changedKeys(
      existing,
      mergedPersonValues(existing, planned, merged.fields),
      PERSON_DIFF_KEYS,
      existing.fields,
      merged.fields,
    ),
    kept: [...declinedKeys(existing, planned), ...keptKeys(existing.fields, merged.suggestions)],
  };
}

function noEmployer(planned: PersonInput): EmployerAssessment {
  return {
    person: planned,
    company: null,
    companyMatch: undefined,
    companyChanged: false,
    outcome: 'none',
    changes: [],
    kept: [],
  };
}

async function employerOf(
  executor: Executor,
  context: ImportContext,
  planned: PersonInput,
  company: CompanyInput,
  existing: StoredPerson | null,
  simulation: Simulation,
): Promise<EmployerAssessment> {
  const assessed = await assessCompany(executor, context, company, simulation);
  const unchanged = {
    person: planned,
    company,
    companyMatch: assessed.existing,
    companyChanged: assessed.outcome === 'create' || assessed.changes.length > 0,
    outcome: assessed.outcome,
  };
  if (existing === null) return { ...unchanged, changes: [], kept: [] };
  const current = await personRowById(executor, context.organizationId, existing.id);
  if (current.companyId === null) return { ...unchanged, changes: ['company'], kept: [] };
  if (assessed.existing === undefined || current.companyId !== assessed.existing.id) {
    return { ...noEmployer({ ...planned, company: null, title: null }), kept: ['company'] };
  }
  if (planned.title === null || planned.title === current.title) {
    return { ...unchanged, changes: [], kept: [] };
  }
  if (current.title === null) return { ...unchanged, changes: ['title'], kept: [] };
  return { ...unchanged, person: { ...planned, title: null }, changes: [], kept: ['title'] };
}

async function leadOf(
  executor: Executor,
  context: ImportContext,
  row: PlannedRow,
  existing: StoredPerson | null,
): Promise<LeadAssessment> {
  const pipelineId = context.setup.pipelineId;
  if (context.setup.target !== 'leads' || row.lead === null || pipelineId === null) {
    return { lead: 'none', leadKey: null };
  }
  if (existing === null) return { lead: 'create', leadKey: null };
  const lead = await existingLeadFor(executor, context.organizationId, existing.id, pipelineId);
  return lead === undefined
    ? { lead: 'create', leadKey: null }
    : { lead: 'exists', leadKey: lead.key };
}

const NO_IDENTITY =
  'This row has no email, LinkedIn or source id, so importing the whole file again would add it twice.';

function identityWarnings(row: PlannedRow, planned: PersonInput): ImportRowOutcome['issues'] {
  const identified =
    row.sourceId !== null ||
    planned.emails.length > 0 ||
    planned.linkedinUrl !== null ||
    planned.linkedinProviderId !== null;
  return identified
    ? []
    : [{ row: row.row, column: null, code: 'no_identity', message: NO_IDENTITY }];
}

function personStatus(matched: boolean, changes: readonly string[]): ImportRowOutcome['status'] {
  if (!matched) return 'create';
  return changes.length > 0 ? 'merge' : 'unchanged';
}

function writesAnything(
  row: PlannedRow,
  match: KnownPerson | null,
  preferredId: string | null,
  status: ImportRowOutcome['status'],
  employer: EmployerAssessment,
  lead: LeadAssessment,
): boolean {
  if (match === null || status !== 'unchanged' || lead.lead === 'create') return true;
  if (employer.companyChanged) return true;
  return row.sourceId !== null && preferredId !== match.row.id;
}

async function assessPersonRow(
  executor: Executor,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<Assessment> {
  const planned = row.person;
  if (planned === null) return { ...NOTHING, outcome: outcomeOf(row, 'invalid') };
  const preferredId =
    row.sourceId === null
      ? null
      : await sourceLinkedPersonId(executor, context.organizationId, context.source, row.sourceId);
  const match = await findPersonMatch(executor, context.organizationId, planned, {
    lock: context.lock,
    preferredId,
  });
  if (match !== null) {
    const refusal = await refusalOf(executor, context, row, planned, match, simulation);
    if (refusal !== null) return refusal;
  }
  const existing = match?.row ?? null;
  const delta =
    existing === null ? { changes: [], kept: [] } : personDelta(context, existing, planned);
  const employer =
    row.company === null
      ? noEmployer(planned)
      : await employerOf(executor, context, planned, row.company, existing, simulation);
  const lead = await leadOf(executor, context, row, existing);
  const changes = [...delta.changes, ...employer.changes];
  const status = personStatus(match !== null, changes);
  return {
    person: employer.person,
    company: employer.company,
    preferredId,
    createLead: lead.lead === 'create',
    match,
    companyMatch: employer.companyMatch,
    writes: writesAnything(row, match, preferredId, status, employer, lead),
    outcome: outcomeOf(row, status, {
      matchedBy: match?.matchedBy ?? null,
      recordId: existing?.id ?? null,
      changes,
      kept: [...delta.kept, ...employer.kept],
      company: employer.outcome,
      lead: lead.lead,
      leadKey: lead.leadKey,
      issues: status === 'create' ? identityWarnings(row, planned) : [],
    }),
  };
}

async function assessRow(
  executor: Executor,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<Assessment> {
  if (row.issues.length > 0) return { ...NOTHING, outcome: outcomeOf(row, 'invalid') };
  if (row.duplicateOf !== null) {
    return skippedOutcome(row, 'same_record', `Same record as row ${row.duplicateOf}.`);
  }
  return context.setup.target === 'companies'
    ? await assessCompanyRow(executor, context, row, simulation)
    : await assessPersonRow(executor, context, row, simulation);
}

function rememberedPerson(context: ImportContext, assessed: Assessment): string | null {
  return context.setup.target === 'companies' ? null : assessed.outcome.recordId;
}

async function previewRowIn(
  tx: Executor,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<ImportRowOutcome> {
  const assessed = await assessRow(tx, context, row, simulation);
  remember(simulation, assessed, rememberedPerson(context, assessed));
  return assessed.outcome;
}

interface CommittedRow {
  readonly outcome: ImportRowOutcome;
  readonly lead: LeadDraft | null;
}

function leadDraftOf(personId: string, row: PlannedRow): LeadDraft | null {
  if (row.lead === null) return null;
  return {
    personId,
    stageId: row.lead.stageId,
    ownerId: row.lead.ownerId,
    priority: row.lead.priority,
    source: 'import',
    nextAction: row.lead.nextAction,
    nextActionAt: row.lead.nextActionAt,
    fields: row.lead.fields,
  };
}

function writtenCompany(company: CompanyRow | null): Promise<CompanyRow> {
  return company === null
    ? Promise.reject(internal('The company of this import row was not written.'))
    : Promise.resolve(company);
}

async function commitPersonIn(
  batch: SyncBatch,
  context: ImportContext,
  row: PlannedRow,
  assessed: Assessment,
  simulation: Simulation,
): Promise<CommittedRow> {
  const { outcome } = assessed;
  if (assessed.person === null) return { outcome, lead: null };
  const company =
    assessed.company === null
      ? null
      : (await writeCompanyIn(batch, assessed.company, assessed.companyMatch)).company;
  const written = await writePersonIn(batch, assessed.person, assessed.match, () =>
    writtenCompany(company),
  );
  const personId = written.person.id;
  if (row.sourceId !== null && assessed.preferredId !== personId) {
    await linkImportSource(
      batch.tx,
      context.organizationId,
      context.source,
      row.sourceId,
      personId,
    );
  }
  remember(simulation, assessed, personId);
  return {
    outcome: { ...outcome, recordId: personId },
    lead: assessed.createLead ? leadDraftOf(personId, row) : null,
  };
}

async function commitRowIn(
  batch: SyncBatch,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<CommittedRow> {
  const assessed = await assessRow(batch.tx, context, row, simulation);
  const { outcome } = assessed;
  if (!isWritten(outcome)) return { outcome, lead: null };
  if (!assessed.writes) {
    remember(simulation, assessed, rememberedPerson(context, assessed));
    return { outcome, lead: null };
  }
  if (context.setup.target !== 'companies') {
    return await commitPersonIn(batch, context, row, assessed, simulation);
  }
  if (assessed.company === null) return { outcome, lead: null };
  const written = await writeCompanyIn(batch, assessed.company, assessed.companyMatch);
  remember(simulation, assessed, null);
  return { outcome: { ...outcome, recordId: written.company.id }, lead: null };
}

async function loadSetup(principal: Principal, request: ImportRequest): Promise<ImportSetup> {
  const organizationId = principal.organizationId;
  const pipeline =
    request.pipelineId === null ? null : await livePipeline(db, organizationId, request.pipelineId);
  const [person, company, lead, stages, members] = await Promise.all([
    loadFieldDefinitions(db, organizationId, 'person', null),
    loadFieldDefinitions(db, organizationId, 'company', null),
    pipeline === null
      ? Promise.resolve([])
      : loadFieldDefinitions(db, organizationId, 'lead', pipeline.id),
    pipeline === null ? Promise.resolve([]) : liveStagesOf(db, organizationId, [pipeline.id]),
    listMembers(principal),
  ]);
  return {
    target: request.target,
    pipelineId: pipeline?.id ?? null,
    stages: stages.map((stage) => ({ id: stage.id, name: stage.name, category: stage.category })),
    members: members.map((entry) => ({
      userId: entry.user.id,
      name: entry.user.name,
      email: entry.user.email,
    })),
    fields: { person, company, lead },
    defaultOwnerId: request.defaultOwner === 'me' ? principal.userId : null,
  };
}

async function prepareImport(
  principal: Principal,
  input: unknown,
  limits: ImportLimits,
): Promise<PreparedImport & { readonly setup: ImportSetup }> {
  const request = importRequestSchema.parse(input);
  const table = parseImportTable(request.format, request.content, limits);
  const setup = await loadSetup(principal, request);
  const issues = mappingIssues(request.mapping, request.target, table.headers, {
    person: setup.fields.person.map((field) => field.key),
    company: setup.fields.company.map((field) => field.key),
    lead: setup.fields.lead.map((field) => field.key),
  });
  const first = issues[0];
  if (first !== undefined) throw validationFailed(first, { details: { issues } });
  const planned = planImport(table, request.mapping, setup);
  if (request.startRow > planned.length) {
    throw validationFailed(
      `This file has ${counted(planned.length, 'row')}, so it cannot start at row ${request.startRow}.`,
    );
  }
  const remaining = planned.slice(request.startRow - 1);
  const rows =
    request.rowLimit === null ? remaining : remaining.slice(0, Math.max(request.rowLimit, 0));
  return { request, setup, rows, remaining };
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function importContextOf(
  principal: Principal,
  prepared: PreparedImport & { readonly setup: ImportSetup },
  actor: Actor,
  lock: boolean,
): ImportContext {
  return {
    organizationId: principal.organizationId,
    setup: prepared.setup,
    source: prepared.request.source,
    actor,
    now: new Date(),
    lock,
  };
}

interface ChunkPlan {
  readonly rows: number;
  readonly now: () => number;
  readonly deadline: number | undefined;
}

function chunkPlanOf(options: ImportPreviewOptions, defaultRows: number): ChunkPlan {
  const rows = options.chunkRows ?? defaultRows;
  return {
    rows: Number.isInteger(rows) && rows > 0 ? rows : 1,
    now: options.now ?? Date.now,
    deadline: options.deadline,
  };
}

function pastDeadline(plan: ChunkPlan): boolean {
  return plan.deadline !== undefined && plan.now() >= plan.deadline;
}

async function takeChunk<T>(
  rows: readonly PlannedRow[],
  start: number,
  plan: ChunkPlan,
  handle: (row: PlannedRow) => Promise<T>,
): Promise<T[]> {
  const startedAt = plan.now();
  const taken: T[] = [];
  for (let index = start; index < rows.length; index += 1) {
    const later = index > start;
    if (later && (index - start >= plan.rows || plan.now() - startedAt >= IMPORT_CHUNK_MS)) break;
    const row = rows[index];
    if (row === undefined) break;
    taken.push(await handle(row));
  }
  return taken;
}

function nextRowOf(prepared: PreparedImport, done: number): number {
  return prepared.remaining[done]?.row ?? prepared.request.startRow + done;
}

function stoppedAt(
  mode: ImportReport['mode'],
  prepared: PreparedImport,
  done: readonly ImportRowOutcome[],
): ImportReport['failure'] {
  const next = nextRowOf(prepared, done.length);
  const last = done.at(-1)?.row;
  const where = last === undefined ? `Stopped before row ${next}` : `Stopped after row ${last}`;
  const rest =
    mode === 'preview' ? 'The rows after it were not checked.' : `Continue from row ${next}.`;
  return { row: null, message: `${where} to stay within the time limit. ${rest}` };
}

function limitReached(
  mode: ImportReport['mode'],
  prepared: PreparedImport,
  done: number,
): ImportReport['failure'] {
  const next = nextRowOf(prepared, done);
  const what =
    mode === 'preview'
      ? `Checked the first ${counted(done, 'row')}.`
      : `Imported the ${counted(done, 'row')} the preview checked.`;
  return { row: null, message: `${what} Continue from row ${next}.` };
}

function reportOf(
  mode: ImportReport['mode'],
  prepared: PreparedImport,
  rows: readonly ImportRowOutcome[],
  failure: ImportReport['failure'],
): ImportReport {
  const stopped =
    failure ??
    (rows.length < prepared.remaining.length ? limitReached(mode, prepared, rows.length) : null);
  return {
    mode,
    status: stopped === null ? 'completed' : 'partial',
    target: prepared.request.target,
    totals: totalsOf(rows, prepared.remaining.length),
    rows: [...rows],
    failure: stopped,
    resumeFromRow: stopped === null ? null : nextRowOf(prepared, rows.length),
  };
}

export async function previewImport(
  principal: Principal,
  input: unknown,
  options: ImportPreviewOptions = {},
): Promise<ImportReport> {
  assertCan(principal, 'import:run');
  const prepared = await prepareImport(principal, input, options.limits ?? HTTP_IMPORT_LIMITS);
  const context = importContextOf(
    principal,
    prepared,
    importActor(principal, principal.userId),
    false,
  );
  const plan = chunkPlanOf(options, IMPORT_PREVIEW_CHUNK_ROWS);
  const simulation = emptySimulation();
  const outcomes: ImportRowOutcome[] = [];
  while (outcomes.length < prepared.rows.length) {
    if (pastDeadline(plan)) {
      return reportOf('preview', prepared, outcomes, stoppedAt('preview', prepared, outcomes));
    }
    const start = outcomes.length;
    const assessed = await cappedTransaction(
      (tx) =>
        takeChunk(prepared.rows, start, plan, (row) => previewRowIn(tx, context, row, simulation)),
      { accessMode: 'read only' },
    );
    outcomes.push(...assessed);
  }
  return reportOf('preview', prepared, outcomes, null);
}

interface ChunkProgress {
  blamed: number | null;
  last: number;
}

function rangeText(first: number, last: number): string {
  return first === last
    ? `Row ${first} was not imported; the rows before it were.`
    : `Rows ${first} to ${last} were not imported; the rows before them were.`;
}

function failureOf(
  error: unknown,
  firstRow: number,
  progress: ChunkProgress,
): ImportReport['failure'] {
  const domain = toDomainError(asConflict(error));
  if (domain.status >= 500) console.error('An import chunk failed and was rolled back.', error);
  const reason = domain.status >= 500 ? 'Something went wrong on our side.' : domain.message;
  if (progress.blamed === null) {
    return {
      row: null,
      message: `${reason} ${rangeText(firstRow, progress.last)} Continue from row ${firstRow}.`,
    };
  }
  return {
    row: progress.blamed,
    message: `${reason} Nothing from row ${firstRow} on was imported; the rows before it were. Fix row ${progress.blamed}, then continue from row ${firstRow}.`,
  };
}

async function publishChunk(
  publish: ImportRunOptions['publish'],
  actions: readonly SyncAction[],
): Promise<void> {
  if (publish === undefined || actions.length === 0) return;
  try {
    await publish(actions);
  } catch (error: unknown) {
    console.error(
      'An imported chunk was saved but not published; the outbox job will retry.',
      error,
    );
  }
}

async function writeChunkIn(
  batch: SyncBatch,
  context: ImportContext,
  rows: readonly PlannedRow[],
  start: number,
  plan: ChunkPlan,
  simulation: Simulation,
  progress: ChunkProgress,
): Promise<ImportRowOutcome[]> {
  const pending: { readonly index: number; readonly row: number; readonly draft: LeadDraft }[] = [];
  let index = 0;
  const outcomes = await takeChunk(rows, start, plan, async (row) => {
    progress.blamed = row.row;
    progress.last = row.row;
    const committed = await commitRowIn(batch, context, row, simulation);
    if (committed.lead !== null) pending.push({ index, row: row.row, draft: committed.lead });
    index += 1;
    progress.blamed = null;
    return committed.outcome;
  });
  const pipelineId = context.setup.pipelineId;
  if (pending.length === 0 || pipelineId === null) return outcomes;
  const leads = await createLeadsIn(
    batch,
    pipelineId,
    pending.map((entry) => entry.draft),
    (position) => {
      progress.blamed = position === null ? null : (pending[position]?.row ?? null);
    },
  );
  const keys = new Map(pending.map((entry, position) => [entry.index, leads[position]?.key]));
  return outcomes.map((outcome, position) => {
    const key = keys.get(position);
    return key === undefined ? outcome : { ...outcome, leadKey: key };
  });
}

export async function commitImport(
  context: WriteContext,
  input: unknown,
  options: ImportRunOptions,
): Promise<ImportReport> {
  assertCan(context.principal, 'import:run');
  const actor = importActor(context.principal, options.actorName);
  const writeContext: WriteContext = { ...context, actor };
  const prepared = await prepareImport(
    context.principal,
    input,
    options.limits ?? HTTP_IMPORT_LIMITS,
  );
  const importContext = importContextOf(context.principal, prepared, actor, true);
  const plan = chunkPlanOf(options, IMPORT_CHUNK_ROWS);
  let simulation = emptySimulation();
  const outcomes: ImportRowOutcome[] = [];
  while (outcomes.length < prepared.rows.length) {
    const start = outcomes.length;
    if (pastDeadline(plan)) {
      return reportOf('commit', prepared, outcomes, stoppedAt('commit', prepared, outcomes));
    }
    const firstRow = prepared.rows[start]?.row ?? 0;
    const progress: ChunkProgress = { blamed: null, last: firstRow };
    let attempt = simulation;
    let written: { rows: ImportRowOutcome[]; actions: SyncAction[] };
    try {
      written = await retryOnUniqueViolation(() =>
        withBatch(writeContext, async (batch) => {
          attempt = forkSimulation(simulation);
          progress.blamed = null;
          const rows = await writeChunkIn(
            batch,
            importContext,
            prepared.rows,
            start,
            plan,
            attempt,
            progress,
          );
          return { rows };
        }),
      );
    } catch (error: unknown) {
      return reportOf('commit', prepared, outcomes, failureOf(error, firstRow, progress));
    }
    simulation = attempt;
    outcomes.push(...written.rows);
    await publishChunk(options.publish, written.actions);
  }
  return reportOf('commit', prepared, outcomes, null);
}
