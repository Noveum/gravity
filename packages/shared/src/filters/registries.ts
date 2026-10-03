import {
  type FieldObject,
  type FieldType,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
  OWED_BY,
  OWED_BY_LABELS,
  STAGE_CATEGORIES,
  STAGE_CATEGORY_LABELS,
} from '../constants/crm.ts';
import type { CompanyRow, FieldDefinitionRow, LeadRow, PersonRow } from '../records/rows.ts';
import type {
  FilterObject,
  FilterProperty,
  FilterReadValue,
  FilterRegistry,
  FilterValueKind,
} from './registry.ts';

export function fieldKindOf(type: FieldType): FilterValueKind {
  switch (type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'select':
      return 'enum';
    case 'multi_select':
      return 'multi';
    default:
      return 'text';
  }
}

function fieldValue(
  fields: Readonly<Record<string, unknown>>,
  key: string,
  kind: FilterValueKind,
): FilterReadValue {
  const raw = fields[key];
  if (kind === 'multi') {
    return Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  return null;
}

export function filterableFieldDefinitions(
  definitions: readonly FieldDefinitionRow[],
  object: FieldObject,
  pipelineId: string | null,
): FieldDefinitionRow[] {
  return definitions.filter(
    (definition) =>
      definition.object === object &&
      definition.archivedAt === null &&
      (definition.pipelineId === null || definition.pipelineId === pipelineId),
  );
}

export function fieldFilterProperties<
  T extends { readonly fields: Readonly<Record<string, unknown>> },
>(
  definitions: readonly FieldDefinitionRow[],
  object: FieldObject,
  pipelineId: string | null,
): FilterProperty<T>[] {
  return filterableFieldDefinitions(definitions, object, pipelineId).map((definition) => {
    const kind = fieldKindOf(definition.type);
    return {
      key: `fields.${definition.key}`,
      label: definition.label,
      kind,
      ...(kind === 'enum' || kind === 'multi' ? { options: definition.options } : {}),
      read: (record: T) => fieldValue(record.fields, definition.key, kind),
    };
  });
}

const PRIORITY_OPTIONS = LEAD_PRIORITIES.map((priority) => ({
  value: String(priority),
  label: LEAD_PRIORITY_LABELS[priority],
}));
const OWED_BY_OPTIONS = OWED_BY.map((value) => ({ value, label: OWED_BY_LABELS[value] }));
const CATEGORY_OPTIONS = STAGE_CATEGORIES.map((value) => ({
  value,
  label: STAGE_CATEGORY_LABELS[value],
}));

export function leadFilterRegistry(
  definitions: readonly FieldDefinitionRow[] = [],
  pipelineId: string | null = null,
): FilterRegistry<LeadRow> {
  return {
    object: 'lead',
    properties: [
      { key: 'stage', label: 'Stage', kind: 'id', read: (lead) => lead.stageId },
      {
        key: 'stageCategory',
        label: 'Stage type',
        kind: 'enum',
        options: CATEGORY_OPTIONS,
        read: (lead) => lead.stageCategory,
      },
      { key: 'owner', label: 'Owner', kind: 'id', allowsMe: true, read: (lead) => lead.ownerId },
      {
        key: 'priority',
        label: 'Priority',
        kind: 'number',
        options: PRIORITY_OPTIONS,
        read: (lead) => lead.priority,
      },
      {
        key: 'owedBy',
        label: 'Owed by',
        kind: 'enum',
        options: OWED_BY_OPTIONS,
        read: (lead) => (lead.owedBy === 'none' ? null : lead.owedBy),
      },
      { key: 'source', label: 'Source', kind: 'text', read: (lead) => lead.source },
      { key: 'person', label: 'Person', kind: 'text', read: (lead) => lead.personName },
      { key: 'email', label: 'Email', kind: 'text', read: (lead) => lead.personEmail },
      { key: 'company', label: 'Company', kind: 'text', read: (lead) => lead.companyName },
      {
        key: 'nextActionAt',
        label: 'Next action date',
        kind: 'date',
        read: (lead) => lead.nextActionAt,
      },
      { key: 'holdUntil', label: 'On hold until', kind: 'date', read: (lead) => lead.holdUntil },
      {
        key: 'lastOutboundAt',
        label: 'Last touch',
        kind: 'date',
        read: (lead) => lead.lastOutboundAt,
      },
      { key: 'created', label: 'Created', kind: 'date', read: (lead) => lead.createdAt },
      { key: 'updated', label: 'Updated', kind: 'date', read: (lead) => lead.updatedAt },
      ...fieldFilterProperties<LeadRow>(definitions, 'lead', pipelineId),
    ],
    search: (lead) => [lead.personName, lead.personEmail, lead.companyName, lead.key],
  };
}

export function personFilterRegistry(
  definitions: readonly FieldDefinitionRow[] = [],
): FilterRegistry<PersonRow> {
  return {
    object: 'person',
    properties: [
      { key: 'name', label: 'Name', kind: 'text', read: (person) => person.name },
      { key: 'email', label: 'Email', kind: 'text', read: (person) => person.emails.join(' ') },
      { key: 'company', label: 'Company', kind: 'text', read: (person) => person.companyName },
      { key: 'title', label: 'Title', kind: 'text', read: (person) => person.title },
      { key: 'location', label: 'Location', kind: 'text', read: (person) => person.location },
      { key: 'timezone', label: 'Time zone', kind: 'text', read: (person) => person.timezone },
      {
        key: 'doNotContact',
        label: 'Do not contact',
        kind: 'boolean',
        read: (person) => person.doNotContact,
      },
      { key: 'created', label: 'Created', kind: 'date', read: (person) => person.createdAt },
      { key: 'updated', label: 'Updated', kind: 'date', read: (person) => person.updatedAt },
      ...fieldFilterProperties<PersonRow>(definitions, 'person', null),
    ],
    search: (person) => [person.name, person.primaryEmail, person.companyName, person.linkedinUrl],
  };
}

export function companyFilterRegistry(
  definitions: readonly FieldDefinitionRow[] = [],
): FilterRegistry<CompanyRow> {
  return {
    object: 'company',
    properties: [
      { key: 'name', label: 'Name', kind: 'text', read: (company) => company.name },
      {
        key: 'domain',
        label: 'Domain',
        kind: 'text',
        read: (company) => company.domains.join(' '),
      },
      { key: 'segment', label: 'Segment', kind: 'text', read: (company) => company.segment },
      { key: 'size', label: 'Size', kind: 'text', read: (company) => company.size },
      { key: 'location', label: 'Location', kind: 'text', read: (company) => company.location },
      { key: 'created', label: 'Created', kind: 'date', read: (company) => company.createdAt },
      { key: 'updated', label: 'Updated', kind: 'date', read: (company) => company.updatedAt },
      ...fieldFilterProperties<CompanyRow>(definitions, 'company', null),
    ],
    search: (company) => [company.name, company.primaryDomain],
  };
}

export function registryFor(
  object: 'lead',
  definitions: readonly FieldDefinitionRow[],
  pipelineId: string | null,
): FilterRegistry<LeadRow>;
export function registryFor(
  object: 'person',
  definitions: readonly FieldDefinitionRow[],
  pipelineId: string | null,
): FilterRegistry<PersonRow>;
export function registryFor(
  object: 'company',
  definitions: readonly FieldDefinitionRow[],
  pipelineId: string | null,
): FilterRegistry<CompanyRow>;
export function registryFor(
  object: FilterObject,
  definitions: readonly FieldDefinitionRow[],
  pipelineId: string | null,
): FilterRegistry<LeadRow> | FilterRegistry<PersonRow> | FilterRegistry<CompanyRow>;
export function registryFor(
  object: FilterObject,
  definitions: readonly FieldDefinitionRow[],
  pipelineId: string | null,
): FilterRegistry<LeadRow> | FilterRegistry<PersonRow> | FilterRegistry<CompanyRow> {
  if (object === 'lead') return leadFilterRegistry(definitions, pipelineId);
  if (object === 'person') return personFilterRegistry(definitions);
  return companyFilterRegistry(definitions);
}
