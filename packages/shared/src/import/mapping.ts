import { z } from 'zod';
import { fieldKeySchema } from '../validators/configuration.ts';
import { type ImportTarget, MAX_IMPORT_COLUMNS, MAX_IMPORT_HEADER_LENGTH } from './constants.ts';

export const IMPORT_STANDARD_COLUMNS = [
  'ignore',
  'sourceId',
  'person.name',
  'person.firstName',
  'person.lastName',
  'person.email',
  'person.phone',
  'person.linkedinUrl',
  'person.linkedinProviderId',
  'person.location',
  'person.timezone',
  'person.title',
  'person.doNotContact',
  'company.name',
  'company.domain',
  'company.size',
  'company.segment',
  'company.location',
  'lead.stage',
  'lead.owner',
  'lead.priority',
  'lead.nextAction',
  'lead.nextActionAt',
] as const;
export type ImportStandardColumn = (typeof IMPORT_STANDARD_COLUMNS)[number];

export const IMPORT_FIELD_OBJECTS = ['person', 'company', 'lead'] as const;
export type ImportFieldObject = (typeof IMPORT_FIELD_OBJECTS)[number];
export type ImportCustomColumn = `${ImportFieldObject}.field.${string}`;
export type ImportColumn = ImportStandardColumn | ImportCustomColumn;

const CUSTOM_COLUMN = /^(person|company|lead)\.field\.([\s\S]*)$/;

const STANDARD_LABELS: Readonly<Record<ImportStandardColumn, string>> = {
  ignore: 'Skip',
  sourceId: 'Source id',
  'person.name': 'Name',
  'person.firstName': 'First name',
  'person.lastName': 'Last name',
  'person.email': 'Email',
  'person.phone': 'Phone',
  'person.linkedinUrl': 'LinkedIn URL',
  'person.linkedinProviderId': 'LinkedIn id',
  'person.location': 'Location',
  'person.timezone': 'Time zone',
  'person.title': 'Job title',
  'person.doNotContact': 'Do not contact',
  'company.name': 'Company name',
  'company.domain': 'Company domain',
  'company.size': 'Company size',
  'company.segment': 'Company segment',
  'company.location': 'Company location',
  'lead.stage': 'Lead stage',
  'lead.owner': 'Lead owner',
  'lead.priority': 'Lead priority',
  'lead.nextAction': 'Next action',
  'lead.nextActionAt': 'Next action date',
};

function isFieldObject(value: string): value is ImportFieldObject {
  return IMPORT_FIELD_OBJECTS.some((object) => object === value);
}

export function customColumn(object: ImportFieldObject, key: string): ImportColumn {
  return `${object}.field.${key}`;
}

export function customFieldOf(column: string): { object: ImportFieldObject; key: string } | null {
  const match = CUSTOM_COLUMN.exec(column);
  const object = match?.[1];
  const key = match?.[2];
  if (object === undefined || key === undefined || !isFieldObject(object)) return null;
  const parsed = fieldKeySchema.safeParse(key);
  return parsed.success && parsed.data === key ? { object, key } : null;
}

function isStandardColumn(value: string): value is ImportStandardColumn {
  return IMPORT_STANDARD_COLUMNS.some((column) => column === value);
}

export function isImportColumn(value: string): value is ImportColumn {
  return isStandardColumn(value) || customFieldOf(value) !== null;
}

export function importColumnLabel(column: ImportColumn): string {
  if (isStandardColumn(column)) return STANDARD_LABELS[column];
  const custom = customFieldOf(column);
  return custom === null ? column : `${custom.object} field ${custom.key}`;
}

export const importColumnSchema = z
  .string()
  .max(80)
  .transform((value, ctx): ImportColumn => {
    if (isImportColumn(value)) return value;
    ctx.addIssue({ code: 'custom', message: `${value} is not an import column.` });
    return z.NEVER;
  });

export type ImportMapping = Record<string, ImportColumn>;

export const importMappingSchema = z
  .record(z.string().min(1).max(MAX_IMPORT_HEADER_LENGTH), importColumnSchema)
  .refine(
    (mapping) => Object.keys(mapping).length <= MAX_IMPORT_COLUMNS,
    `Map at most ${MAX_IMPORT_COLUMNS} columns.`,
  );

const OBJECTS_BY_TARGET: Readonly<Record<ImportTarget, readonly ImportFieldObject[]>> = {
  people: ['person', 'company'],
  companies: ['company'],
  leads: ['person', 'company', 'lead'],
};

export function columnAllowed(target: ImportTarget, column: ImportColumn): boolean {
  if (column === 'ignore') return true;
  if (column === 'sourceId') return target !== 'companies';
  const object = column.split('.')[0] ?? '';
  return OBJECTS_BY_TARGET[target].some((entry) => entry === object);
}

const REPEATABLE: readonly ImportColumn[] = ['ignore', 'person.email', 'person.phone'];

export function mappingIssues(
  mapping: ImportMapping,
  target: ImportTarget,
  headers: readonly string[],
  fieldKeys: Readonly<Record<ImportFieldObject, readonly string[]>>,
): string[] {
  const issues: string[] = [];
  const used = new Map<ImportColumn, string>();
  for (const [header, column] of Object.entries(mapping)) {
    if (!headers.includes(header)) issues.push(`The file has no column called ${header}.`);
    if (!columnAllowed(target, column)) {
      issues.push(`${importColumnLabel(column)} cannot be imported into ${target}.`);
    }
    const custom = customFieldOf(column);
    if (custom !== null && !fieldKeys[custom.object].includes(custom.key)) {
      issues.push(`There is no ${custom.object} field called ${custom.key}.`);
    }
    const previous = used.get(column);
    if (previous !== undefined && !REPEATABLE.includes(column)) {
      issues.push(
        `${header} and ${previous} both map to ${importColumnLabel(column)}. Map each field once.`,
      );
    }
    used.set(column, header);
  }
  const mapped = new Set(Object.values(mapping));
  if (target === 'companies') {
    if (!(mapped.has('company.name') || mapped.has('company.domain'))) {
      issues.push('Map a company name or domain column.');
    }
  } else if (
    !(mapped.has('person.name') || mapped.has('person.firstName') || mapped.has('person.lastName'))
  ) {
    issues.push('Map a name column, or first and last name columns.');
  }
  return issues;
}

const SYNONYMS: readonly (readonly [ImportStandardColumn, readonly string[]])[] = [
  ['person.email', ['email', 'e mail', 'email address', 'work email', 'personal email', 'mail']],
  ['person.name', ['name', 'full name', 'contact', 'contact name', 'person']],
  ['person.firstName', ['first name', 'firstname', 'given name']],
  ['person.lastName', ['last name', 'lastname', 'surname', 'family name']],
  ['person.phone', ['phone', 'phone number', 'mobile', 'telephone']],
  ['person.linkedinUrl', ['linkedin', 'linkedin url', 'linkedin profile', 'profile url']],
  ['person.linkedinProviderId', ['linkedin id', 'provider id', 'linkedin provider id']],
  ['person.title', ['title', 'job title', 'position', 'role']],
  ['person.location', ['location', 'city']],
  ['person.timezone', ['timezone', 'time zone', 'tz']],
  ['person.doNotContact', ['do not contact', 'dnc', 'opted out']],
  [
    'company.name',
    ['company', 'company name', 'organization', 'organisation', 'account', 'employer'],
  ],
  ['company.domain', ['domain', 'website', 'company domain', 'company website', 'url']],
  ['company.size', ['size', 'company size', 'employees', 'headcount']],
  ['company.segment', ['segment', 'industry']],
  ['company.location', ['company location', 'hq', 'headquarters', 'location']],
  ['lead.stage', ['stage', 'status', 'lead stage']],
  ['lead.owner', ['owner', 'lead owner', 'assigned to', 'assignee']],
  ['lead.priority', ['priority']],
  ['lead.nextAction', ['next action', 'next step']],
  ['lead.nextActionAt', ['next action date', 'next action at', 'follow up date', 'due']],
  ['sourceId', ['source id', 'external id']],
];

function normalizedHeader(header: string): string {
  return header.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function suggestMapping(
  headers: readonly string[],
  target: ImportTarget,
  definitions: readonly {
    readonly object: string;
    readonly key: string;
    readonly label: string;
  }[],
): ImportMapping {
  const entries: [string, ImportColumn][] = [];
  const taken = new Set<ImportColumn>();
  for (const header of headers) {
    const normalized = normalizedHeader(header);
    let column: ImportColumn | undefined;
    for (const definition of definitions) {
      if (!isFieldObject(definition.object)) continue;
      const candidate = customColumn(definition.object, definition.key);
      if (
        customFieldOf(candidate) !== null &&
        columnAllowed(target, candidate) &&
        !taken.has(candidate) &&
        (normalizedHeader(definition.key) === normalized ||
          normalizedHeader(definition.label) === normalized)
      ) {
        column = candidate;
        break;
      }
    }
    column ??= SYNONYMS.find(
      ([candidate, names]) =>
        names.includes(normalized) &&
        columnAllowed(target, candidate) &&
        (REPEATABLE.includes(candidate) || !taken.has(candidate)),
    )?.[0];
    const chosen: ImportColumn = column ?? 'ignore';
    entries.push([header, chosen]);
    taken.add(chosen);
  }
  return Object.fromEntries(entries);
}
