import { type SQL, schema, sql } from '@gravity/db';
import type { FieldObject } from '@gravity/shared/constants';
import {
  type FilterValueKind,
  fieldKindOf,
  filterableFieldDefinitions,
} from '@gravity/shared/filters';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import type { AnyColumn } from 'drizzle-orm';
import { currentCompanyName, currentTitle } from './current-company.ts';
import type { SqlFilterProperty, SqlFilterRegistry } from './filter-sql.ts';

function utcDayOf(column: AnyColumn): SQL {
  return sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;
}

function typedWhen(value: SQL, jsonType: string, then: SQL): SQL {
  return sql`(case when jsonb_typeof(${value}) = ${jsonType} then ${then} end)`;
}

function fieldProperty(fields: AnyColumn, key: string, kind: FilterValueKind): SqlFilterProperty {
  const value = sql`(${fields} -> ${key}::text)`;
  const text = sql`(${value} #>> '{}')`;
  const present = sql`jsonb_typeof(${value}) in ('string', 'number', 'boolean')`;
  switch (kind) {
    case 'multi':
      return { kind, expression: value };
    case 'number':
      return { kind, expression: typedWhen(value, 'number', sql`${value}::float8`), present };
    case 'boolean':
      return { kind, expression: typedWhen(value, 'boolean', sql`${value}::boolean`) };
    case 'date':
      return {
        kind,
        expression: sql`(case when jsonb_typeof(${value}) = 'string' and length(${text}) >= 10 then left(${text}, 10) end)`,
      };
    default:
      return { kind, expression: typedWhen(value, 'string', text), present };
  }
}

function fieldSqlProperties(
  definitions: readonly FieldDefinitionRow[],
  object: FieldObject,
  pipelineId: string | null,
  fields: AnyColumn,
): [string, SqlFilterProperty][] {
  return filterableFieldDefinitions(definitions, object, pipelineId).map((definition) => [
    `fields.${definition.key}`,
    fieldProperty(fields, definition.key, fieldKindOf(definition.type)),
  ]);
}

export function leadSqlRegistry(
  definitions: readonly FieldDefinitionRow[],
  pipelineId: string | null,
): SqlFilterRegistry {
  return new Map<string, SqlFilterProperty>([
    ['stage', { kind: 'id', expression: schema.lead.stageId }],
    ['stageCategory', { kind: 'enum', expression: schema.lead.stageCategory }],
    ['owner', { kind: 'id', expression: schema.lead.ownerId, allowsMe: true }],
    ['priority', { kind: 'number', expression: schema.lead.priority }],
    ['owedBy', { kind: 'enum', expression: sql`nullif(${schema.lead.owedBy}, 'none')` }],
    ['source', { kind: 'text', expression: schema.lead.source }],
    ['person', { kind: 'text', expression: schema.person.name }],
    ['email', { kind: 'text', expression: schema.person.primaryEmail }],
    ['company', { kind: 'text', expression: currentCompanyName(schema.lead.personId) }],
    ['nextActionAt', { kind: 'date', expression: utcDayOf(schema.lead.nextActionAt) }],
    ['holdUntil', { kind: 'date', expression: utcDayOf(schema.lead.holdUntil) }],
    ['lastOutboundAt', { kind: 'date', expression: utcDayOf(schema.lead.lastOutboundAt) }],
    ['created', { kind: 'date', expression: utcDayOf(schema.lead.createdAt) }],
    ['updated', { kind: 'date', expression: utcDayOf(schema.lead.updatedAt) }],
    ...fieldSqlProperties(definitions, 'lead', pipelineId, schema.lead.fields),
  ]);
}

export const LEAD_SEARCH_EXPRESSIONS: readonly (SQL | AnyColumn)[] = [
  schema.person.name,
  schema.person.primaryEmail,
  currentCompanyName(schema.lead.personId),
  sql`${schema.pipeline.key} || '-' || ${schema.lead.number}`,
];

export function personSqlRegistry(definitions: readonly FieldDefinitionRow[]): SqlFilterRegistry {
  return new Map<string, SqlFilterProperty>([
    ['name', { kind: 'text', expression: schema.person.name }],
    ['email', { kind: 'text', expression: sql`array_to_string(${schema.person.emails}, ' ')` }],
    ['company', { kind: 'text', expression: currentCompanyName(schema.person.id) }],
    ['title', { kind: 'text', expression: currentTitle(schema.person.id) }],
    ['location', { kind: 'text', expression: schema.person.location }],
    ['timezone', { kind: 'text', expression: schema.person.timezone }],
    ['doNotContact', { kind: 'boolean', expression: schema.person.doNotContact }],
    ['created', { kind: 'date', expression: utcDayOf(schema.person.createdAt) }],
    ['updated', { kind: 'date', expression: utcDayOf(schema.person.updatedAt) }],
    ...fieldSqlProperties(definitions, 'person', null, schema.person.fields),
  ]);
}

export const PERSON_SEARCH_EXPRESSIONS: readonly (SQL | AnyColumn)[] = [
  schema.person.name,
  schema.person.primaryEmail,
  currentCompanyName(schema.person.id),
  schema.person.linkedinUrl,
];

export function companySqlRegistry(definitions: readonly FieldDefinitionRow[]): SqlFilterRegistry {
  return new Map<string, SqlFilterProperty>([
    ['name', { kind: 'text', expression: schema.company.name }],
    ['domain', { kind: 'text', expression: sql`array_to_string(${schema.company.domains}, ' ')` }],
    ['segment', { kind: 'text', expression: schema.company.segment }],
    ['size', { kind: 'text', expression: schema.company.size }],
    ['location', { kind: 'text', expression: schema.company.location }],
    ['created', { kind: 'date', expression: utcDayOf(schema.company.createdAt) }],
    ['updated', { kind: 'date', expression: utcDayOf(schema.company.updatedAt) }],
    ...fieldSqlProperties(definitions, 'company', null, schema.company.fields),
  ]);
}

export const COMPANY_SEARCH_EXPRESSIONS: readonly (SQL | AnyColumn)[] = [
  schema.company.name,
  schema.company.primaryDomain,
];
