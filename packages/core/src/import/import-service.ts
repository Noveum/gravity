import { and, db, eq, isNull, ne, type SQL, schema } from '@gravity/db';
import { toDomainError, validationFailed } from '@gravity/shared/errors';
import type { Actor, SyncAction } from '@gravity/shared/events';
import {
  HTTP_IMPORT_LIMITS,
  IMPORT_CHUNK_ROWS,
  IMPORT_PREVIEW_CHUNK_ROWS,
  type ImportLimits,
  type ImportReport,
  type ImportRequest,
  type ImportRowOutcome,
  type ImportSetup,
  importRequestSchema,
  mappingIssues,
  type PlannedLead,
  type PlannedRow,
  parseImportTable,
  planImport,
  totalsOf,
} from '@gravity/shared/import';
import { assertCan, type Principal } from '@gravity/shared/policy';
import type { LeadRow } from '@gravity/shared/records';
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
  upsertCompanyIn,
} from '../crm/company-service.ts';
import { asConflict } from '../crm/conflicts.ts';
import { loadFieldDefinitions } from '../crm/field-service.ts';
import { selectLeadRows } from '../crm/lead-rows.ts';
import { createLeadIn, openLeadFor } from '../crm/lead-service.ts';
import { livePipeline, liveStagesOf } from '../crm/lookups.ts';
import { personRowById } from '../crm/person-lookup.ts';
import {
  findPersonMatch,
  mergedPersonValues,
  PERSON_DIFF_KEYS,
  type PersonMatch,
  type StoredPerson,
  upsertPersonIn,
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
}

interface CompanyAssessment {
  readonly outcome: 'create' | 'match';
  readonly existing: StoredCompany | undefined;
  readonly changes: string[];
  readonly kept: string[];
}

const NOTHING = { person: null, company: null, preferredId: null, createLead: false } as const;

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
  message: string,
  extra: Partial<ImportRowOutcome> = {},
): Assessment {
  return {
    ...NOTHING,
    outcome: outcomeOf(row, 'skipped', {
      ...extra,
      issues: [{ row: row.row, column: null, message }],
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
  const planned = companyLookupKeys(input).some((key) => simulation.companies.has(key));
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
    return { ...NOTHING, company: input, outcome: outcomeOf(row, 'create', { company: 'create' }) };
  }
  return {
    ...NOTHING,
    company: input,
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
  planned: PlannedLead,
): Promise<LeadRow | undefined> {
  const open = await openLeadFor(executor, organizationId, personId, pipelineId);
  const closedStart = planned.stageCategory === 'won' || planned.stageCategory === 'lost';
  if (open !== undefined || !closedStart || planned.stageId === undefined) return open;
  const [closed] = await selectLeadRows(
    executor,
    organizationId,
    and(
      eq(schema.lead.personId, personId),
      eq(schema.lead.pipelineId, pipelineId),
      eq(schema.lead.stageId, planned.stageId),
      isNull(schema.lead.archivedAt),
    ),
    { limit: 1 },
  );
  return closed;
}

interface PersonMatchResult {
  readonly row: StoredPerson;
  readonly matchedBy: PersonMatch;
}

interface Delta {
  readonly changes: string[];
  readonly kept: string[];
}

interface EmployerAssessment extends Delta {
  readonly person: PersonInput;
  readonly company: CompanyInput | null;
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
  match: PersonMatchResult,
  simulation: Simulation,
): Promise<Assessment | null> {
  const matched = { matchedBy: match.matchedBy, recordId: match.row.id };
  const earlier = simulation.people.get(match.row.id);
  if (earlier !== undefined) return skippedOutcome(row, `Same record as row ${earlier}.`, matched);
  const conflict = await claimConflict(executor, context.organizationId, match.row, planned);
  return conflict === null ? null : skippedOutcome(row, conflict, matched);
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
    kept: keptKeys(existing.fields, merged.suggestions),
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
  const unchanged = { person: planned, company, outcome: assessed.outcome };
  if (existing === null) return { ...unchanged, changes: [], kept: [] };
  const current = await personRowById(executor, context.organizationId, existing.id);
  if (current.companyId === null) return { ...unchanged, changes: ['company'], kept: [] };
  if (assessed.existing === undefined || current.companyId !== assessed.existing.id) {
    return {
      person: { ...planned, company: null, title: null },
      company: null,
      outcome: 'none',
      changes: [],
      kept: ['company'],
    };
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
  const lead = await existingLeadFor(
    executor,
    context.organizationId,
    existing.id,
    pipelineId,
    row.lead,
  );
  return lead === undefined
    ? { lead: 'create', leadKey: null }
    : { lead: 'exists', leadKey: lead.key };
}

function personStatus(matched: boolean, changes: readonly string[]): ImportRowOutcome['status'] {
  if (!matched) return 'create';
  return changes.length > 0 ? 'merge' : 'unchanged';
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
      ? { person: planned, company: null, outcome: 'none' as const, changes: [], kept: [] }
      : await employerOf(executor, context, planned, row.company, existing, simulation);
  const lead = await leadOf(executor, context, row, existing);
  const changes = [...delta.changes, ...employer.changes];
  return {
    person: employer.person,
    company: employer.company,
    preferredId,
    createLead: lead.lead === 'create',
    outcome: outcomeOf(row, personStatus(match !== null, changes), {
      matchedBy: match?.matchedBy ?? null,
      recordId: existing?.id ?? null,
      changes,
      kept: [...delta.kept, ...employer.kept],
      company: employer.outcome,
      lead: lead.lead,
      leadKey: lead.leadKey,
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
  if (row.duplicateOf !== null)
    return skippedOutcome(row, `Same record as row ${row.duplicateOf}.`);
  return context.setup.target === 'companies'
    ? await assessCompanyRow(executor, context, row, simulation)
    : await assessPersonRow(executor, context, row, simulation);
}

async function previewRowIn(
  tx: Executor,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<ImportRowOutcome> {
  const assessed = await assessRow(tx, context, row, simulation);
  remember(
    simulation,
    assessed,
    context.setup.target === 'companies' ? null : assessed.outcome.recordId,
  );
  return assessed.outcome;
}

async function commitRowIn(
  batch: SyncBatch,
  context: ImportContext,
  row: PlannedRow,
  simulation: Simulation,
): Promise<ImportRowOutcome> {
  const assessed = await assessRow(batch.tx, context, row, simulation);
  const { outcome } = assessed;
  if (!isWritten(outcome)) return outcome;
  if (context.setup.target === 'companies') {
    if (assessed.company === null) return outcome;
    const written = await upsertCompanyIn(batch, assessed.company);
    remember(simulation, assessed, null);
    return { ...outcome, recordId: written.company.id };
  }
  if (assessed.person === null) return outcome;
  if (assessed.company !== null) await upsertCompanyIn(batch, assessed.company);
  const written = await upsertPersonIn(batch, assessed.person, assessed.preferredId);
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
  const pipelineId = context.setup.pipelineId;
  if (!assessed.createLead || row.lead === null || pipelineId === null) {
    return { ...outcome, recordId: personId };
  }
  const lead = await createLeadIn(batch, {
    personId,
    pipelineId,
    stageId: row.lead.stageId,
    ownerId: row.lead.ownerId,
    priority: row.lead.priority,
    source: 'import',
    nextAction: row.lead.nextAction,
    nextActionAt: row.lead.nextActionAt,
    fields: row.lead.fields,
  });
  return { ...outcome, recordId: personId, leadKey: lead.key };
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
  return { request, setup, rows: planImport(table, request.mapping, setup) };
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

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const step = Number.isInteger(size) && size > 0 ? size : 1;
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += step) {
    chunks.push(items.slice(index, index + step));
  }
  return chunks;
}

function reportOf(
  mode: ImportReport['mode'],
  prepared: PreparedImport,
  rows: readonly ImportRowOutcome[],
  failure: ImportReport['failure'],
): ImportReport {
  return {
    mode,
    status: failure === null ? 'completed' : 'partial',
    target: prepared.request.target,
    totals: totalsOf(rows, prepared.rows.length),
    rows: [...rows],
    failure,
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
  const simulation = emptySimulation();
  const outcomes: ImportRowOutcome[] = [];
  for (const chunk of chunksOf(prepared.rows, options.chunkRows ?? IMPORT_PREVIEW_CHUNK_ROWS)) {
    const assessed = await cappedTransaction(
      async (tx) => {
        const rows: ImportRowOutcome[] = [];
        for (const row of chunk) rows.push(await previewRowIn(tx, context, row, simulation));
        return rows;
      },
      { accessMode: 'read only' },
    );
    outcomes.push(...assessed);
  }
  return reportOf('preview', prepared, outcomes, null);
}

function failureOf(error: unknown, firstRow: number, failingRow: number): ImportReport['failure'] {
  const domain = toDomainError(asConflict(error));
  if (domain.status >= 500) console.error('An import chunk failed and was rolled back.', error);
  const reason = domain.status >= 500 ? 'Something went wrong on our side.' : domain.message;
  return {
    row: failingRow,
    message: `${reason} Nothing from row ${firstRow} on was imported; the rows before it were. Fix row ${failingRow} and run the same file again to continue.`,
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
  let simulation = emptySimulation();
  const outcomes: ImportRowOutcome[] = [];
  for (const chunk of chunksOf(prepared.rows, options.chunkRows ?? IMPORT_CHUNK_ROWS)) {
    const firstRow = chunk[0]?.row ?? 0;
    let failingRow = firstRow;
    let attempt = simulation;
    let written: { rows: ImportRowOutcome[]; actions: SyncAction[] };
    try {
      written = await retryOnUniqueViolation(() =>
        withBatch(writeContext, async (batch) => {
          attempt = forkSimulation(simulation);
          const rows: ImportRowOutcome[] = [];
          for (const row of chunk) {
            failingRow = row.row;
            rows.push(await commitRowIn(batch, importContext, row, attempt));
          }
          return { rows };
        }),
      );
    } catch (error: unknown) {
      return reportOf('commit', prepared, outcomes, failureOf(error, firstRow, failingRow));
    }
    simulation = attempt;
    outcomes.push(...written.rows);
    await publishChunk(options.publish, written.actions);
  }
  return reportOf('commit', prepared, outcomes, null);
}
