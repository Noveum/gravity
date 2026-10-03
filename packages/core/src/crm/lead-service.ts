import { and, asc, db, eq, inArray, isNull, ne, schema, sql } from '@gravity/db';
import { type ActivityKind, isOpenCategory } from '@gravity/shared/constants';
import { conflict, type DomainError, notFound, validationFailed } from '@gravity/shared/errors';
import { assertCan, type Principal } from '@gravity/shared/policy';
import {
  type ActivityLinkRow,
  type CompanyRow,
  type LeadRow,
  type LeadState,
  leadStateOf,
  type PersonRow,
  resolveLeadChange,
  type StageRow,
} from '@gravity/shared/records';
import { parseLeadKey } from '@gravity/shared/utils';
import {
  type FieldValue,
  fieldsMetaSchema,
  type LeadChange,
  type LeadCreate,
  type LeadPatch,
  leadBulkSchema,
  leadChangeSchema,
  leadCreateSchema,
  mergeFields,
  quickCreateSchema,
} from '@gravity/shared/validators';
import { type Executor, newId, requireRow } from '../internal.ts';
import { diffValues, recordActivity } from './activity-service.ts';
import { asConflict, violatedConstraint } from './conflicts.ts';
import { validateFieldInput } from './field-service.ts';
import { leadRowById, selectLeadRows } from './lead-rows.ts';
import { assertMember, livePipeline } from './lookups.ts';
import { livePerson } from './person-lookup.ts';
import { upsertPersonIn } from './person-service.ts';
import { stageRowOf } from './rows.ts';
import { leadScopes } from './scopes.ts';
import {
  retryOnUniqueViolation,
  type SyncBatch,
  type WithActions,
  withBatch,
} from './sync-batch.ts';
import { type WriteContext, writeActor } from './write-context.ts';

export interface QuickCreated {
  readonly lead: LeadRow;
  readonly person: PersonRow;
  readonly company: CompanyRow | null;
  readonly personCreated: boolean;
}

const OPEN_LEAD_CONSTRAINT = 'lead_open_person_pipeline_unique';
const UNKNOWN_LEADS = 'One or more of those leads do not exist.';

const LEAD_DIFF_KEYS = [
  'stageId',
  'ownerId',
  'priority',
  'nextAction',
  'nextActionAt',
  'holdReason',
  'holdUntil',
  'owedBy',
  'fields',
] as const;

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function isNotOpenLeadClash(error: unknown): boolean {
  return violatedConstraint(error) !== OPEN_LEAD_CONSTRAINT;
}

export async function openLeadFor(
  executor: Executor,
  organizationId: string,
  personId: string,
  pipelineId: string,
  excludeLeadId?: string,
): Promise<LeadRow | undefined> {
  const [row] = await selectLeadRows(
    executor,
    organizationId,
    and(
      eq(schema.lead.personId, personId),
      eq(schema.lead.pipelineId, pipelineId),
      inArray(schema.lead.stageCategory, ['open', 'hold']),
      isNull(schema.lead.archivedAt),
      excludeLeadId === undefined ? undefined : ne(schema.lead.id, excludeLeadId),
    ),
    { limit: 1 },
  );
  return row;
}

function openLeadConflict(existing: LeadRow): DomainError {
  return conflict(
    `${existing.personName} already has an open lead in this pipeline: ${existing.key}.`,
    { details: { leadId: existing.id, key: existing.key } },
  );
}

async function lockStagesOf(batch: SyncBatch, pipelineIds: readonly string[]): Promise<StageRow[]> {
  if (pipelineIds.length === 0) return [];
  const rows = await batch.tx
    .select()
    .from(schema.stage)
    .where(
      and(
        eq(schema.stage.organizationId, batch.organizationId),
        inArray(schema.stage.pipelineId, [...pipelineIds]),
      ),
    )
    .orderBy(asc(schema.stage.pipelineId), asc(schema.stage.sortOrder), asc(schema.stage.id))
    .for('share');
  return rows.map(stageRowOf);
}

function startingStage(stages: readonly StageRow[], stageId: string | undefined): StageRow {
  const live = stages.filter((stage) => stage.archivedAt === null);
  const stage =
    stageId === undefined
      ? live.find((candidate) => candidate.category === 'open')
      : live.find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    throw stageId === undefined
      ? conflict('This pipeline has no open stage. Add one in Settings.')
      : validationFailed('That stage is not in this pipeline.', { details: { stageId } });
  }
  if (stage.category === 'hold') {
    throw validationFailed('Start a lead in an open stage, then put it on hold with a reason.');
  }
  return stage;
}

function leadLinks(lead: LeadRow): ActivityLinkRow[] {
  return [
    { entityType: 'lead', entityId: lead.id },
    { entityType: 'person', entityId: lead.personId },
    ...(lead.companyId === null
      ? []
      : [{ entityType: 'company' as const, entityId: lead.companyId }]),
  ];
}

function emitLead(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update',
  lead: LeadRow,
): void {
  batch.emit({
    syncId,
    action,
    model: 'lead',
    modelId: lead.id,
    data: lead,
    scopes: leadScopes(batch.organizationId, lead),
  });
}

async function nextLeadNumber(batch: SyncBatch, pipelineId: string): Promise<number> {
  const [counter] = await batch.tx
    .update(schema.pipeline)
    .set({ leadCounter: sql`${schema.pipeline.leadCounter} + 1` })
    .where(eq(schema.pipeline.id, pipelineId))
    .returning({ number: schema.pipeline.leadCounter });
  return requireRow(counter, 'That pipeline does not exist.').number;
}

export async function createLeadIn(batch: SyncBatch, input: LeadCreate): Promise<LeadRow> {
  const organizationId = batch.organizationId;
  await livePerson(batch.tx, organizationId, input.personId);
  const pipeline = await livePipeline(batch.tx, organizationId, input.pipelineId, true);
  const stage = startingStage(await lockStagesOf(batch, [pipeline.id]), input.stageId);
  if (isOpenCategory(stage.category)) {
    const existing = await openLeadFor(batch.tx, organizationId, input.personId, pipeline.id);
    if (existing !== undefined) throw openLeadConflict(existing);
  }
  const ownerId = input.ownerId === undefined ? batch.context.principal.userId : input.ownerId;
  if (ownerId !== null) await assertMember(batch.tx, organizationId, ownerId);
  const fields = await validateFieldInput(
    batch.tx,
    organizationId,
    'lead',
    pipeline.id,
    input.fields,
  );
  const merged = mergeFields({}, {}, fields, writeActor(batch.context), new Date());
  const number = await nextLeadNumber(batch, pipeline.id);
  const syncId = await batch.nextSyncId();
  const id = input.id ?? newId();
  await batch.tx.insert(schema.lead).values({
    id,
    organizationId,
    personId: input.personId,
    pipelineId: pipeline.id,
    number,
    ownerId,
    stageId: stage.id,
    stageCategory: stage.category,
    source: input.source,
    priority: input.priority,
    nextAction: input.nextAction,
    nextActionAt: toDate(input.nextActionAt),
    fields: merged.fields,
    fieldsMeta: merged.meta,
    syncId,
  });
  const lead = await leadRowById(batch.tx, organizationId, id);
  emitLead(batch, syncId, 'insert', lead);
  await recordActivity(batch, {
    kind: 'lead.created',
    payload: { leadId: lead.id, key: lead.key, stage: { id: stage.id, name: stage.name } },
    links: leadLinks(lead),
  });
  return lead;
}

export async function createLead(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ lead: LeadRow }>> {
  assertCan(context.principal, 'record:write');
  const parsed = leadCreateSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => ({ lead: await createLeadIn(batch, parsed) }));
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function quickCreateLead(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<QuickCreated>> {
  assertCan(context.principal, 'record:write');
  const parsed = quickCreateSchema.parse(input);
  try {
    return await retryOnUniqueViolation(
      () =>
        withBatch(context, async (batch) => {
          await livePipeline(batch.tx, batch.organizationId, parsed.pipelineId, true);
          const upserted = await upsertPersonIn(batch, parsed.person);
          const lead = await createLeadIn(batch, {
            id: parsed.leadId,
            personId: upserted.person.id,
            pipelineId: parsed.pipelineId,
            ownerId: parsed.ownerId,
            priority: 0,
            source: 'manual',
            nextAction: null,
            nextActionAt: null,
            fields: {},
          });
          return {
            lead,
            person: upserted.person,
            company: upserted.company,
            personCreated: upserted.created,
          };
        }),
      2,
      isNotOpenLeadClash,
    );
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

function activityKindFor(change: LeadChange, keys: readonly string[]): ActivityKind {
  if (change.type === 'hold') return 'lead.held';
  if (change.type === 'close') return 'lead.closed';
  if (keys.includes('stageId')) return 'lead.stage_changed';
  if (keys.every((key) => key === 'ownerId')) return 'lead.owner_changed';
  if (keys.every((key) => key === 'priority')) return 'lead.priority_changed';
  if (keys.every((key) => key === 'nextAction' || key === 'nextActionAt')) {
    return 'lead.next_action_changed';
  }
  return 'lead.updated';
}

function describeChanges(
  changes: Record<string, { from: unknown; to: unknown }>,
  stages: readonly StageRow[],
): Record<string, unknown> {
  const stageOf = (id: unknown) => {
    const stage = stages.find((candidate) => candidate.id === id);
    return stage === undefined ? { id } : { id: stage.id, name: stage.name };
  };
  const stage = changes['stageId'];
  return stage === undefined
    ? changes
    : { ...changes, stageId: { from: stageOf(stage.from), to: stageOf(stage.to) } };
}

function withoutFields(change: LeadChange): LeadChange {
  if (change.type !== 'update' || change.patch.fields === undefined) return change;
  const patch: LeadPatch = { ...change.patch, fields: undefined };
  return { type: 'update', patch };
}

interface MergedLeadFields {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly fieldsMeta: Record<string, unknown> | null;
}

async function mergeLeadFieldsIn(
  batch: SyncBatch,
  before: LeadRow,
  fieldInput: Readonly<Record<string, FieldValue>> | null,
): Promise<MergedLeadFields> {
  if (fieldInput === null) return { fields: before.fields, fieldsMeta: null };
  const [stored] = await batch.tx
    .select({ fieldsMeta: schema.lead.fieldsMeta })
    .from(schema.lead)
    .where(eq(schema.lead.id, before.id));
  const merged = mergeFields(
    before.fields,
    fieldsMetaSchema.parse(stored?.fieldsMeta ?? {}),
    fieldInput,
    writeActor(batch.context),
    new Date(),
  );
  return { fields: merged.fields, fieldsMeta: merged.meta };
}

async function applyChangeIn(
  batch: SyncBatch,
  before: LeadRow,
  change: LeadChange,
  stages: readonly StageRow[],
  fieldInput: Readonly<Record<string, FieldValue>> | null,
): Promise<LeadRow> {
  const resolved = resolveLeadChange(leadStateOf(before), withoutFields(change), stages);
  const merged = await mergeLeadFieldsIn(batch, before, fieldInput);
  const next: LeadState = { ...resolved, fields: merged.fields };
  const changes = diffValues(leadStateOf(before), next, LEAD_DIFF_KEYS);
  const keys = Object.keys(changes);
  if (keys.length === 0) return before;
  if (isOpenCategory(next.stageCategory) && !isOpenCategory(before.stageCategory)) {
    const existing = await openLeadFor(
      batch.tx,
      batch.organizationId,
      before.personId,
      before.pipelineId,
      before.id,
    );
    if (existing !== undefined) throw openLeadConflict(existing);
  }
  const syncId = await batch.nextSyncId();
  await batch.tx
    .update(schema.lead)
    .set({
      stageId: next.stageId,
      stageCategory: next.stageCategory,
      ownerId: next.ownerId,
      priority: next.priority,
      nextAction: next.nextAction,
      nextActionAt: toDate(next.nextActionAt),
      holdReason: next.holdReason,
      holdUntil: toDate(next.holdUntil),
      owedBy: next.owedBy,
      fields: { ...next.fields },
      ...(merged.fieldsMeta === null ? {} : { fieldsMeta: merged.fieldsMeta }),
      syncId,
      updatedAt: new Date(),
    })
    .where(eq(schema.lead.id, before.id));
  const lead = await leadRowById(batch.tx, batch.organizationId, before.id);
  emitLead(batch, syncId, 'update', lead);
  await recordActivity(batch, {
    kind: activityKindFor(change, keys),
    payload: { leadId: lead.id, key: lead.key, changes: describeChanges(changes, stages) },
    links: leadLinks(lead),
  });
  return lead;
}

async function lockLeadsIn(batch: SyncBatch, leadIds: readonly string[]): Promise<LeadRow[]> {
  const organizationId = batch.organizationId;
  const ids = [...leadIds];
  const owned = and(eq(schema.lead.organizationId, organizationId), inArray(schema.lead.id, ids));
  const pipelines = await batch.tx
    .selectDistinct({ id: schema.lead.pipelineId })
    .from(schema.lead)
    .where(owned);
  const pipelineIds = pipelines.map((row) => row.id);
  if (pipelineIds.length === 0) throw notFound(UNKNOWN_LEADS);
  const live = await batch.tx
    .select({ id: schema.pipeline.id })
    .from(schema.pipeline)
    .where(
      and(
        eq(schema.pipeline.organizationId, organizationId),
        inArray(schema.pipeline.id, pipelineIds),
        isNull(schema.pipeline.archivedAt),
      ),
    )
    .orderBy(asc(schema.pipeline.id))
    .for('share');
  if (live.length !== pipelineIds.length) throw notFound(UNKNOWN_LEADS);
  await batch.tx
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(owned)
    .orderBy(asc(schema.lead.id))
    .for('update');
  const before = await selectLeadRows(
    batch.tx,
    organizationId,
    and(inArray(schema.lead.id, ids), isNull(schema.lead.archivedAt)),
  );
  if (before.length !== ids.length) throw notFound(UNKNOWN_LEADS);
  return before;
}

async function fieldInputsFor(
  batch: SyncBatch,
  change: LeadChange,
  pipelineIds: readonly string[],
): Promise<Map<string, Record<string, FieldValue>>> {
  const inputs = new Map<string, Record<string, FieldValue>>();
  if (change.type !== 'update' || change.patch.fields === undefined) return inputs;
  for (const pipelineId of pipelineIds) {
    inputs.set(
      pipelineId,
      await validateFieldInput(
        batch.tx,
        batch.organizationId,
        'lead',
        pipelineId,
        change.patch.fields,
      ),
    );
  }
  return inputs;
}

async function changeLeadsIn(
  batch: SyncBatch,
  leadIds: readonly string[],
  change: LeadChange,
): Promise<{ leads: LeadRow[] }> {
  const before = await lockLeadsIn(batch, leadIds);
  const pipelineIds = [...new Set(before.map((lead) => lead.pipelineId))];
  const stages = await lockStagesOf(batch, pipelineIds);
  const ownerId = change.type === 'update' ? change.patch.ownerId : undefined;
  if (ownerId !== undefined && ownerId !== null) {
    await assertMember(batch.tx, batch.organizationId, ownerId);
  }
  const fieldInputs = await fieldInputsFor(batch, change, pipelineIds);
  const byId = new Map(before.map((lead) => [lead.id, lead]));
  const leads: LeadRow[] = [];
  for (const id of leadIds) {
    const lead = byId.get(id);
    if (lead === undefined) continue;
    leads.push(
      await applyChangeIn(batch, lead, change, stages, fieldInputs.get(lead.pipelineId) ?? null),
    );
  }
  return { leads };
}

export async function changeLeads(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ leads: LeadRow[] }>> {
  assertCan(context.principal, 'record:write');
  const parsed = leadBulkSchema.parse(input);
  try {
    return await withBatch(context, (batch) => changeLeadsIn(batch, parsed.leadIds, parsed.change));
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function changeLead(
  context: WriteContext,
  leadId: string,
  input: unknown,
): Promise<WithActions<{ lead: LeadRow }>> {
  assertCan(context.principal, 'record:write');
  const change = leadChangeSchema.parse(input);
  const result = await changeLeads(context, { leadIds: [leadId], change });
  return {
    lead: requireRow(result.leads[0], 'That lead does not exist.'),
    actions: result.actions,
  };
}

export async function getLead(principal: Principal, leadId: string): Promise<LeadRow> {
  assertCan(principal, 'record:read');
  return await leadRowById(db, principal.organizationId, leadId);
}

export async function getLeadByKey(principal: Principal, raw: string): Promise<LeadRow> {
  assertCan(principal, 'record:read');
  const parsed = parseLeadKey(raw);
  if (parsed === null) throw notFound(`There is no lead ${raw.trim()}.`);
  const [row] = await selectLeadRows(
    db,
    principal.organizationId,
    and(
      eq(schema.pipeline.key, parsed.key),
      eq(schema.lead.number, parsed.number),
      isNull(schema.pipeline.archivedAt),
    ),
    { limit: 1 },
  );
  if (row === undefined) throw notFound(`There is no lead ${parsed.key}-${parsed.number}.`);
  return row;
}
